import assert from "node:assert/strict";
import { test } from "node:test";
import { loadToolCatalogFromYaml } from "../src/tools/catalog-loader.js";
import { PluginRegistry } from "../src/tools/plugin-registry.js";
import { YamlToolRuntime } from "../src/tools/yaml-tool-runtime.js";
import { jsonObjectSchemaToZod } from "../src/agent/langchain-schemas.js";
import { createAmdcLangChainTools } from "../src/agent/langchain-tool-wrapper.js";
import { executePrometheusHttpTool } from "../src/tools/source-adapters/prometheus-http-adapter.js";

const registry = new PluginRegistry(loadToolCatalogFromYaml("src/tools/catalogs/amdb-tools.yaml"));
const ctx = { environment: "dev" as const, referenceTime: new Date("2026-09-17T06:00:00Z") };
const input = { metricName: "up", start: "2026-09-17T05:50:00Z", end: "2026-09-17T06:00:00Z" };

test("unfiltered schema and runtime reject invented labels; scoped tools require an identifier", async () => {
  const runtime = new YamlToolRuntime(registry);
  for (const kind of ["series", "value", "range"]) {
    const name = "prometheus_get_metric_" + kind;
    const args = kind === "value" ? { metricName: "up" } : input;
    const tool = registry.getTool(name)!;
    assert.ok(jsonObjectSchemaToZod(tool.inputSchema).safeParse(args).success);
    for (const field of ["job", "instance", "databaseName", "username", "device", "mode", "hostgroup"]) {
      const invalid = { ...args, [field]: "none" };
      assert.equal(jsonObjectSchemaToZod(tool.inputSchema).safeParse(invalid).success, false);
      const result = await runtime.execute({ toolName: name, args: invalid }, ctx);
      assert.ok(!result.ok && result.error.code === "invalid_input");
    }
    for (const [suffix, field] of [["instance", "instance"], ["database", "databaseName"]]) {
      const schema = jsonObjectSchemaToZod(registry.getTool(name + "_by_" + suffix)!.inputSchema);
      assert.equal(schema.safeParse(args).success, false);
      assert.ok(schema.safeParse({ ...args, [field]: "observed" }).success);
    }
  }
});

test("filtered reads distinguish unobserved labels, empty samples, and lookup failures", async () => {
  const before = process.env.AMDC_DEV_PROMETHEUS_URL;
  process.env.AMDC_DEV_PROMETHEUS_URL = "http://localhost:9090";
  try {
    const tool = registry.getTool("prometheus_get_metric_range_by_instance")!;
    for (const mode of ["absent", "present", "denied", "malformed", "oversize"] as const) {
      const urls: URL[] = [];
      const result = await executePrometheusHttpTool(tool, ctx, ctx.referenceTime.toISOString(), async url => {
        const u = new URL(String(url)); urls.push(u);
        if (u.pathname === "/api/v1/series") {
          assert.equal(u.searchParams.get("match[]"), '{__name__="up",instance="mysql-exporter:9104"}');
          if (mode === "denied") return new Response("private", { status: 403 });
          if (mode === "malformed") return new Response("null");
          if (mode === "oversize") return new Response(" ".repeat(65537));
          return Response.json({ status: "success", data: mode === "present" ? [{ instance: "mysql-exporter:9104" }] : [] });
        }
        return Response.json({ status: "success", data: { resultType: "matrix", result: [] } });
      }, { ...input, instance: "mysql-exporter:9104" });
      assert.equal(urls.length, mode === "present" ? 2 : 1);
      if (mode === "present") assert.ok(result.ok);
      else {
        assert.ok(!result.ok);
        assert.equal(result.error.code, { absent: "invalid_input", denied: "source_permission_denied", malformed: "malformed_source_response", oversize: "tool_output_too_large" }[mode]);
      }
    }
  } finally {
    if (before === undefined) delete process.env.AMDC_DEV_PROMETHEUS_URL;
    else process.env.AMDC_DEV_PROMETHEUS_URL = before;
  }
});

test("parallel duplicate inputs execute once per run; changed input and new runs execute", async () => {
  const descriptor = registry.listAllTools().find(t => t.name === "prometheus_get_metric_range")!;
  let calls = 0;
  const runtime = { execute: async () => { calls++; return { ok: false as const, error: { toolName: descriptor.name, pluginName: descriptor.pluginName, code: "source_request_failed" as const, message: "fixture", occurredAt: ctx.referenceTime.toISOString() } }; } };
  const make = () => createAmdcLangChainTools([descriptor], runtime, { ...ctx, runId: "fixture", traceSink: { record: async () => {} } })[0];
  const tool = make();
  const results = await Promise.all([tool.invoke(input), tool.invoke({ end: input.end, start: input.start, metricName: input.metricName })]);
  assert.equal(calls, 1);
  assert.ok(results.some(r => String(r).includes("Identical tool input")));
  await tool.invoke({ ...input, metricName: "other" });
  await make().invoke(input);
  assert.equal(calls, 3);
});
