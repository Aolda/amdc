import { spawn } from "node:child_process";
import type {
  LocalShellToolExecution,
  SanitizedToolError,
  ToolDefinition,
  ToolRuntimeContext,
  ToolRuntimeResult
} from "../types.js";

const MAX_OUTPUT_BYTES = 64 * 1024;

export interface LocalShellExecutionResult {
  readonly ok: true;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface LocalShellExecutionFailure {
  readonly ok: false;
  readonly reason: "timeout" | "output_too_large" | "execution_failed";
}

export type LocalShellCommandResult =
  | LocalShellExecutionResult
  | LocalShellExecutionFailure;

export type LocalShellCommandExecutor = (
  command: string,
  timeoutMs: number,
  signal?: AbortSignal
) => Promise<LocalShellCommandResult>;

export async function executeLocalShellTool(
  tool: ToolDefinition,
  context: ToolRuntimeContext,
  occurredAt: string,
  commandExecutor: LocalShellCommandExecutor = executeLocalShellCommand
): Promise<ToolRuntimeResult> {
  if (tool.execution.type !== "local_shell") {
    return {
      ok: false,
      error: buildToolError(
        tool,
        "source_unavailable",
        "Local shell execution is not configured for this tool.",
        occurredAt
      )
    };
  }

  const rendered = renderLocalShellCommand(tool.execution, context);
  if (!rendered.ok) {
    return {
      ok: false,
      error: buildToolError(
        tool,
        "source_unavailable",
        "Tool execution environment is not configured.",
        occurredAt
      )
    };
  }

  const result = await commandExecutor(
    rendered.command,
    tool.timeoutMs,
    context.signal
  );

  if (!result.ok) {
    const error = mapExecutionFailure(result.reason);
    return {
      ok: false,
      error: buildToolError(tool, error.code, error.message, occurredAt)
    };
  }

  if (containsSensitiveSourceOutput(`${result.stdout}\n${result.stderr}`)) {
    return {
      ok: false,
      error: buildToolError(
        tool,
        "secret_exposure_risk",
        "Tool output contained sensitive data.",
        occurredAt
      )
    };
  }

  return {
    ok: true,
    rawResult: {
      toolName: tool.name,
      pluginName: tool.pluginName,
      source: tool.source,
      collectedAt: occurredAt,
      transport: "local_shell",
      execution: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode
      }
    }
  };
}

export function renderLocalShellCommand(
  execution: LocalShellToolExecution,
  context: ToolRuntimeContext
): { readonly ok: true; readonly command: string } | { readonly ok: false } {
  const values = new Map<string, string>();

  for (const [logicalName, environmentSources] of Object.entries(
    execution.environment
  )) {
    const sourceName = environmentSources[context.environment];
    const value = sourceName ? process.env[sourceName]?.trim() : undefined;

    if (!value) {
      return { ok: false };
    }

    values.set(logicalName, value);
  }

  const command = execution.command.replace(
    /{{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*}}/g,
    (_match, logicalName: string) => shellQuote(values.get(logicalName) ?? "")
  );

  return { ok: true, command };
}

export function executeLocalShellCommand(
  command: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<LocalShellCommandResult> {
  return new Promise((resolve) => {
    const child = spawn("/bin/sh", ["-c", command], {
      detached: true,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        LANG: process.env.LANG ?? "C.UTF-8"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let failureReason: LocalShellExecutionFailure["reason"] | null = null;

    const finish = (result: LocalShellCommandResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromParent);
      resolve(result);
    };

    const terminate = (reason: LocalShellExecutionFailure["reason"]) => {
      if (failureReason) {
        return;
      }
      failureReason = reason;
      try {
        if (child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        child.kill("SIGKILL");
      }
    };

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        terminate("output_too_large");
        return;
      }
      target.push(chunk);
    };

    const abortFromParent = () => terminate("timeout");
    const timeout = setTimeout(() => terminate("timeout"), timeoutMs);

    child.stdout.on("data", collect(stdoutChunks));
    child.stderr.on("data", collect(stderrChunks));
    child.on("error", () => finish({ ok: false, reason: "execution_failed" }));
    child.on("close", (exitCode) => {
      if (failureReason) {
        finish({ ok: false, reason: failureReason });
        return;
      }

      finish({
        ok: true,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: exitCode ?? 1
      });
    });

    signal?.addEventListener("abort", abortFromParent, { once: true });
    if (signal?.aborted) {
      abortFromParent();
    }
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function mapExecutionFailure(reason: LocalShellExecutionFailure["reason"]): {
  readonly code: SanitizedToolError["code"];
  readonly message: string;
} {
  if (reason === "timeout") {
    return {
      code: "tool_timeout",
      message: "Tool execution exceeded its deadline."
    };
  }

  if (reason === "output_too_large") {
    return {
      code: "tool_output_too_large",
      message: "Tool output exceeded the allowed size."
    };
  }

  return {
    code: "source_unavailable",
    message: "Tool command could not be executed."
  };
}

function containsSensitiveSourceOutput(value: string): boolean {
  const configuredSecrets = Object.entries(process.env)
    .filter(
      ([name, secret]) =>
        Boolean(secret) &&
        secret!.length >= 8 &&
        /(TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY|SESSION)/i.test(name)
    )
    .map(([, secret]) => secret as string);

  if (configuredSecrets.some((secret) => value.includes(secret))) {
    return true;
  }

  return /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(
    value
  );
}

function buildToolError(
  tool: ToolDefinition,
  code: SanitizedToolError["code"],
  message: string,
  occurredAt: string
): SanitizedToolError {
  return {
    toolName: tool.name,
    pluginName: tool.pluginName,
    code,
    message,
    occurredAt
  };
}
