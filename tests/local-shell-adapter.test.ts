import assert from "node:assert/strict";
import { test } from "node:test";
import {
  executeLocalShellCommand,
  executeLocalShellTool,
  renderLocalShellCommand
} from "../src/tools/source-adapters/local-shell-adapter.js";
import type {
  LocalShellToolExecution,
  ToolDefinition,
  ToolRuntimeContext
} from "../src/tools/types.js";

const execution: LocalShellToolExecution = {
  type: "local_shell",
  command: "curl --silent --include {{ env.backend_health_url }}",
  environment: {
    backend_health_url: {
      dev: "AMDC_DEV_HEALTHCHECK_URL",
      prod: "AMDC_PROD_HEALTHCHECK_URL"
    }
  }
};

const tool: ToolDefinition = {
  name: "backend_get_health",
  pluginName: "backend",
  description: "Read the configured Backend health response.",
  access: { level: 0, readOnly: true },
  source: "amdb_backend",
  allowedEnvironments: ["dev", "prod"],
  timeoutMs: 5_000,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {}
  },
  execution
};

const context: ToolRuntimeContext = {
  environment: "dev",
  referenceTime: new Date("2026-08-26T12:00:00.000Z")
};

test("injects only the server-owned environment value into the fixed command", async () => {
  const result = await withEnvironment(
    { AMDC_DEV_HEALTHCHECK_URL: "http://backend.internal/health?name=o'hare" },
    async () => renderLocalShellCommand(execution, context)
  );

  assert.deepEqual(result, {
    ok: true,
    command:
      "curl --silent --include 'http://backend.internal/health?name=o'\"'\"'hare'"
  });
});

test("returns stdout, stderr, and a non-zero exit code without interpretation", async () => {
  let executedCommand = "";
  const result = await withEnvironment(
    { AMDC_DEV_HEALTHCHECK_URL: "http://backend.internal/health" },
    () =>
      executeLocalShellTool(
        tool,
        context,
        "2026-08-26T12:00:00.000Z",
        async (command) => {
          executedCommand = command;
          return {
            ok: true,
            stdout: "HTTP/1.1 503 Service Unavailable\n\n{\"status\":\"unhealthy\"}",
            stderr: "curl: upstream returned an unhealthy response",
            exitCode: 22
          };
        }
      )
  );

  assert.equal(
    executedCommand,
    "curl --silent --include 'http://backend.internal/health'"
  );
  assert.equal(result.ok, true);
  if (!result.ok || !("rawResult" in result)) {
    assert.fail("Expected a raw local-shell result.");
  }
  assert.deepEqual(result.rawResult.execution, {
    stdout: "HTTP/1.1 503 Service Unavailable\n\n{\"status\":\"unhealthy\"}",
    stderr: "curl: upstream returned an unhealthy response",
    exitCode: 22
  });
});

test("does not execute when the server environment value is missing", async () => {
  let executed = false;
  const result = await withEnvironment(
    { AMDC_DEV_HEALTHCHECK_URL: undefined },
    () =>
      executeLocalShellTool(
        tool,
        context,
        "2026-08-26T12:00:00.000Z",
        async () => {
          executed = true;
          return { ok: true, stdout: "", stderr: "", exitCode: 0 };
        }
      )
  );

  assert.equal(executed, false);
  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("Expected a missing environment configuration error.");
  }
  assert.equal(result.error.code, "source_unavailable");
});

test("executes a fixed command through the local shell and captures raw streams", async () => {
  const result = await executeLocalShellCommand(
    "printf 'raw stdout'; printf 'raw stderr' >&2; exit 7",
    1_000
  );

  assert.deepEqual(result, {
    ok: true,
    stdout: "raw stdout",
    stderr: "raw stderr",
    exitCode: 7
  });
});

async function withEnvironment<T>(
  values: Readonly<Record<string, string | undefined>>,
  run: () => Promise<T> | T
): Promise<T> {
  const previousValues = new Map<string, string | undefined>();

  for (const [name, value] of Object.entries(values)) {
    previousValues.set(name, process.env[name]);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [name, previousValue] of previousValues) {
      if (previousValue === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = previousValue;
      }
    }
  }
}
