import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  createNextPluginSelectionState,
  createPluginSelectionPayload,
  filterToolsForActivePlugin,
  PLUGIN_SELECTION_TOOL_NAME
} from "../src/agent/plugin-lazy-loading.js";
import {
  loadToolCatalogFromYaml,
  parseToolCatalog
} from "../src/tools/catalog-loader.js";
import { PluginRegistry } from "../src/tools/plugin-registry.js";
import { isPluginName, PLUGIN_NAMES } from "../src/tools/types.js";
import type { ToolCatalog } from "../src/tools/types.js";

const catalog: ToolCatalog = {
  plugins: [
    {
      name: "mysql",
      description: "MySQL diagnostic tools.",
      domainHints: ["mysql"],
      tools: [createToolDefinition("mysql", "mysql_check_connections")]
    },
    {
      name: "backend",
      description: "Backend diagnostic tools.",
      domainHints: ["backend"],
      tools: [createToolDefinition("backend", "backend_check_health")]
    }
  ]
};

const registry = new PluginRegistry(catalog);
const availableTools = [
  { name: PLUGIN_SELECTION_TOOL_NAME },
  { name: "mysql_check_connections" },
  { name: "backend_check_health" }
] as never[];

test("initial model call exposes only plugin selection", () => {
  const visible = filterToolsForActivePlugin(availableTools, registry, null);

  assert.deepEqual(visible.map((tool) => tool.name), [PLUGIN_SELECTION_TOOL_NAME]);
});

test("selecting mysql exposes only mysql tools and plugin selection", () => {
  const visible = filterToolsForActivePlugin(availableTools, registry, "mysql");

  assert.deepEqual(
    visible.map((tool) => tool.name),
    [PLUGIN_SELECTION_TOOL_NAME, "mysql_check_connections"]
  );
});

test("switching plugins hides the previous plugin tools", () => {
  const mysqlVisible = filterToolsForActivePlugin(
    availableTools,
    registry,
    "mysql"
  );
  const backendVisible = filterToolsForActivePlugin(
    availableTools,
    registry,
    "backend"
  );

  assert.deepEqual(
    mysqlVisible.map((tool) => tool.name),
    [PLUGIN_SELECTION_TOOL_NAME, "mysql_check_connections"]
  );
  assert.deepEqual(
    backendVisible.map((tool) => tool.name),
    [PLUGIN_SELECTION_TOOL_NAME, "backend_check_health"]
  );
});

test("switching plugins replaces the active plugin and preserves visit history", () => {
  const mysqlState = createNextPluginSelectionState(registry, [], "mysql");
  const backendState = createNextPluginSelectionState(
    registry,
    mysqlState.visitedPlugins,
    "backend"
  );

  assert.deepEqual(mysqlState, {
    activePlugin: "mysql",
    visitedPlugins: ["mysql"]
  });
  assert.deepEqual(backendState, {
    activePlugin: "backend",
    visitedPlugins: ["mysql", "backend"]
  });
});

test("mysql is a canonical plugin name and the legacy db plugin name is rejected", () => {
  assert.equal(isPluginName("mysql"), true);
  assert.equal(isPluginName("db"), false);
  assert.equal(PLUGIN_NAMES.includes("mysql"), true);
});

test("selecting mysql returns its lazy-loaded tool descriptors from the real catalog", () => {
  const catalogPath = fileURLToPath(
    new URL("../src/tools/catalogs/amdb-tools.yaml", import.meta.url)
  );
  const realRegistry = new PluginRegistry(loadToolCatalogFromYaml(catalogPath));
  const payload = createPluginSelectionPayload(realRegistry, "mysql");

  assert.equal(payload.selectedPlugin, "mysql");
  assert.deepEqual(
    payload.loadedTools.map((loadedTool) => loadedTool.name),
    [
      "mysql_list_databases",
      "mysql_get_all_processlist",
      "mysql_get_active_processlist",
      "mysql_get_processlist_by_database",
      "mysql_get_processlist_by_connection_id",
      "mysql_get_all_transactions",
      "mysql_get_transactions_by_connection_id",
      "mysql_get_transaction_by_transaction_id",
      "mysql_get_all_lock_waits",
      "mysql_get_lock_waits_by_database",
      "mysql_get_lock_waits_by_table",
      "mysql_get_lock_waits_by_connection_id"
    ]
  );
  assert.equal(payload.loadedTools.every((loadedTool) => loadedTool.readOnly), true);
});

test("real catalog advertises only plugins with a connected implementation", () => {
  const catalogPath = fileURLToPath(
    new URL("../src/tools/catalogs/amdb-tools.yaml", import.meta.url)
  );
  const realRegistry = new PluginRegistry(loadToolCatalogFromYaml(catalogPath));

  assert.deepEqual(
    realRegistry.listPlugins().map((plugin) => plugin.name),
    ["system", "prometheus", "mysql"]
  );
});

test("mysql selection exposes neutral tool contracts without plugin-specific prompting", () => {
  const realRegistry = new PluginRegistry(loadToolCatalogFromYaml(fileURLToPath(
    new URL("../src/tools/catalogs/amdb-tools.yaml", import.meta.url)
  )));
  const mysql = createPluginSelectionPayload(realRegistry, "mysql");
  assert.deepEqual(Object.keys(mysql).sort(), ["loadedTools", "selectedPlugin"]);
  assert.ok(mysql.loadedTools.every(tool => !/when|use this|incident|diagnos/i.test(tool.description)));
});

test("selecting prometheus exposes only the live target Tool", () => {
  const catalogPath = fileURLToPath(
    new URL("../src/tools/catalogs/amdb-tools.yaml", import.meta.url)
  );
  const realRegistry = new PluginRegistry(loadToolCatalogFromYaml(catalogPath));
  const payload = createPluginSelectionPayload(realRegistry, "prometheus");

  assert.deepEqual(
    payload.loadedTools.map((loadedTool) => loadedTool.name),
    ["prometheus_get_targets"]
  );

  const tool = realRegistry.getTool("prometheus_get_targets");
  assert.equal(tool?.execution.type, "prometheus_http");
  if (!tool || tool.execution.type !== "prometheus_http") {
    assert.fail("Expected prometheus_get_targets to use fixed Prometheus HTTP execution.");
  }
  assert.equal(tool.execution.path, "/api/v1/targets");
  assert.deepEqual(tool.execution.query, { state: "active" });
});

test("catalog rejects Agent-substitutable Prometheus paths and queries", () => {
  const createCatalog = (path: string, query: string) => ({
    plugins: [
      {
        name: "prometheus",
        description: "Prometheus tools.",
        domainHints: ["prometheus"],
        tools: [
          {
            name: "prometheus_test",
            description: "Read fixed Prometheus data.",
            access: { level: 0, readOnly: true },
            source: "prometheus",
            allowedEnvironments: ["dev"],
            timeoutMs: 5_000,
            input: {
              type: "object",
              additionalProperties: false,
              properties: {}
            },
            execution: {
              type: "prometheus_http",
              baseUrlEnvironment: { dev: "AMDC_DEV_PROMETHEUS_URL" },
              path,
              query: { query }
            }
          }
        ]
      }
    ]
  });

  assert.throws(
    () => parseToolCatalog(createCatalog("https://attacker.invalid/api/v1/query", "up")),
    /fixed Prometheus/
  );
  assert.throws(
    () => parseToolCatalog(createCatalog("/api/v1/query", "{{ agent.promql }}")),
    /fixed strings/
  );
});

test("system owns the single raw backend health tool", () => {
  const catalogPath = fileURLToPath(
    new URL("../src/tools/catalogs/amdb-tools.yaml", import.meta.url)
  );
  const realRegistry = new PluginRegistry(loadToolCatalogFromYaml(catalogPath));
  const payload = createPluginSelectionPayload(realRegistry, "system");
  assert.ok(!realRegistry.listPlugins().some(p => p.name === "backend"));
  assert.equal(realRegistry.getTool("system_check_backend_health"), null);
  assert.equal(realRegistry.getTool("system_check_configured_http_health"), null);

  assert.deepEqual(
    payload.loadedTools.map((loadedTool) => loadedTool.name),
    ["backend_get_health"]
  );

  const backendTool = realRegistry.getTool("backend_get_health");
  assert.equal(backendTool?.pluginName, "system");
  assert.equal(backendTool?.execution.type, "local_shell");
  if (!backendTool || backendTool.execution.type !== "local_shell") {
    assert.fail("Expected backend_get_health to use local shell execution.");
  }
  assert.equal(
    backendTool.execution.environment.backend_health_url.dev,
    "AMDC_DEV_HEALTHCHECK_URL"
  );
  assert.match(backendTool.execution.command, /curl/);
});

function createToolDefinition(
  pluginName: "backend" | "mysql",
  name: string
): ToolCatalog["plugins"][number]["tools"][number] {
  return {
    name,
    pluginName,
    description: `${name} description`,
    access: { level: 0, readOnly: true },
    source: pluginName === "mysql" ? "mysql" : "amdb_backend",
    allowedEnvironments: ["dev"],
    timeoutMs: 5_000,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {}
    },
    execution: {
      type: "source_adapter",
      operation: name
    }
  };
}
