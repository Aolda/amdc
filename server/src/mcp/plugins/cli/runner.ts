import { spawn } from "node:child_process";
import type { SessionContext, ToolCallResult } from "../../types.js";
import type { WrapperConfig, WrapperRow } from "../../wrapper.js";
import {
  interpolate,
  interpolateArray,
  interpolateRecord,
  maskSecrets,
  type InterpolationNamespaces,
} from "../../interpolate.js";

export interface CliRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export type CliRunner = (args: {
  command: string;
  argv: string[];
  env: Record<string, string>;
}) => Promise<CliRunResult>;

export const spawnRunner: CliRunner = ({ command, argv, env }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });

function buildNamespaces(
  config: WrapperConfig,
  input: Record<string, unknown>,
  ctx: SessionContext,
): InterpolationNamespaces {
  const environment = ctx.environment ?? "staging";
  const route = config.routing?.[environment] ?? {};
  return {
    input: input as Record<string, string | number | boolean | undefined>,
    secret: (config.secrets ?? {}) as Record<string, string>,
    route: route as Record<string, string | number | boolean | undefined>,
    ctx: {
      environment,
      session: ctx.sessionId,
      agentType: ctx.agentId,
    },
  };
}

export async function runCliTool(
  row: WrapperRow,
  rawInput: unknown,
  ctx: SessionContext,
  runner: CliRunner = spawnRunner,
): Promise<ToolCallResult> {
  const config = row.config;
  const commandArray = config.command ?? [];
  if (commandArray.length === 0) {
    throw new Error(`wrapper '${row.wrapperName}' has empty command`);
  }
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const namespaces = buildNamespaces(config, input, ctx);
  const interpolated = interpolateArray(commandArray, namespaces);
  const [command, ...argv] = interpolated;
  const env = interpolateRecord(config.fixedEnv ?? {}, namespaces);
  const { stdout, stderr, code } = await runner({ command, argv, env });
  const secrets = config.secrets ?? {};
  const maskedOut = maskSecrets(stdout, secrets);
  const maskedErr = maskSecrets(stderr, secrets);
  if (code !== 0) {
    return {
      content: [
        {
          type: "text",
          text: `exit ${code}\n${maskedOut}${maskedErr}`.trim(),
        },
      ],
      isError: true,
    };
  }
  return {
    content: [{ type: "text", text: maskedOut }],
  };
}

// Keeps TS happy about unused import when re-exported elsewhere.
export { interpolate };
