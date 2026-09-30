import assert from "node:assert/strict";
import { test } from "node:test";
import { executePrometheusHttpTool } from "../src/tools/source-adapters/prometheus-http-adapter.js";
import type {
  PrometheusHttpToolExecution,
  ToolDefinition,
  ToolRuntimeContext
} from "../src/tools/types.js";

const execution: PrometheusHttpToolExecution = {
  type: "prometheus_http",
  baseUrlEnvironment: {
    dev: "AMDC_DEV_PROMETHEUS_URL",
    prod: "AMDC_PROD_PROMETHEUS_URL"
  },
  path: "/api/v1/query",
  query: {
    query: '{__name__=~"mysql_up|mysql_global_status_uptime"}'
  }
};

const tool: ToolDefinition = {
  name: "mysql_get_service_status",
  pluginName: "mysql",
  description: "Read MySQL service metrics.",
  access: { level: 0, readOnly: true },
  source: "prometheus",
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
  referenceTime: new Date("2026-08-28T07:00:00.000Z")
};

test("uses the server-owned base URL and fixed Prometheus query", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const rawBody = '{"status":"success","data":{"resultType":"vector","result":[]}}';

  const result = await withEnvironment(
    { AMDC_DEV_PROMETHEUS_URL: "http://prometheus.internal:9090" },
    () =>
      executePrometheusHttpTool(tool, context, context.referenceTime.toISOString(), async (
        input,
        init
      ) => {
        requestedUrl = input.toString();
        requestedInit = init;
        return new Response(rawBody, {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
  );

  const parsedUrl = new URL(requestedUrl);
  assert.equal(parsedUrl.origin, "http://prometheus.internal:9090");
  assert.equal(parsedUrl.pathname, "/api/v1/query");
  assert.equal(parsedUrl.searchParams.get("query"), execution.query.query);
  assert.equal(requestedInit?.method, "GET");
  assert.equal(requestedInit?.redirect, "error");
  assert.equal(result.ok, true);
  if (!result.ok || !("rawResult" in result)) {
    assert.fail("Expected raw Prometheus result.");
  }
  assert.deepEqual(result.rawResult, {
    toolName: "mysql_get_service_status",
    pluginName: "mysql",
    source: "prometheus",
    collectedAt: "2026-08-28T07:00:00.000Z",
    transport: "http",
    response: {
      statusCode: 200,
      contentType: "application/json",
      body: rawBody
    }
  });
});

test("does not request Prometheus when the server-owned URL is missing", async () => {
  let requested = false;
  const result = await withEnvironment(
    { AMDC_DEV_PROMETHEUS_URL: undefined },
    () =>
      executePrometheusHttpTool(tool, context, context.referenceTime.toISOString(), async () => {
        requested = true;
        return new Response("{}", { status: 200 });
      })
  );

  assert.equal(requested, false);
  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("Expected source_unavailable.");
  }
  assert.equal(result.error.code, "source_unavailable");
});

test("does not return an upstream error body", async () => {
  const result = await withEnvironment(
    { AMDC_DEV_PROMETHEUS_URL: "http://prometheus.internal:9090" },
    () =>
      executePrometheusHttpTool(tool, context, context.referenceTime.toISOString(), async () =>
        new Response("upstream internal detail", { status: 500 })
      )
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("Expected source_request_failed.");
  }
  assert.equal(result.error.code, "source_request_failed");
  assert.doesNotMatch(JSON.stringify(result), /upstream internal detail/);
});

test("rejects a Prometheus response larger than 64 KiB", async () => {
  const oversized = JSON.stringify({ data: "x".repeat(65 * 1024) });
  const result = await withEnvironment(
    { AMDC_DEV_PROMETHEUS_URL: "http://prometheus.internal:9090" },
    () =>
      executePrometheusHttpTool(tool, context, context.referenceTime.toISOString(), async () =>
        new Response(oversized, {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(oversized))
          }
        })
      )
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    assert.fail("Expected tool_output_too_large.");
  }
  assert.equal(result.error.code, "tool_output_too_large");
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
