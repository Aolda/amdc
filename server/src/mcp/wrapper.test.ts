import { describe, it, expect } from "vitest";
import {
  mergeWrapperConfig,
  composeListedTools,
  type WrapperConfig,
  type WrapperRow,
} from "./wrapper.js";
import type { ToolDefinition } from "./types.js";

describe("mergeWrapperConfig", () => {
  it("returns empty when both sides empty", () => {
    expect(mergeWrapperConfig({}, {})).toEqual({});
  });

  it("passes mcp config through when tool config is empty", () => {
    const mcp: WrapperConfig = { secrets: { API_KEY: "abc" } };
    expect(mergeWrapperConfig(mcp, {})).toEqual({
      secrets: { API_KEY: "abc" },
    });
  });

  it("tool secrets override mcp secrets at key level", () => {
    const mcp: WrapperConfig = { secrets: { API_KEY: "abc", USER: "ro" } };
    const tool: WrapperConfig = { secrets: { API_KEY: "xyz" } };
    expect(mergeWrapperConfig(mcp, tool).secrets).toEqual({
      API_KEY: "xyz",
      USER: "ro",
    });
  });

  it("routing merges env entries key-wise", () => {
    const mcp: WrapperConfig = {
      routing: { staging: { host: "s.local" }, prod: { host: "p.local" } },
    };
    const tool: WrapperConfig = {
      routing: { prod: { host: "p-override.local", port: 5432 } },
    };
    expect(mergeWrapperConfig(mcp, tool).routing).toEqual({
      staging: { host: "s.local" },
      prod: { host: "p-override.local", port: 5432 },
    });
  });

  it("fixedEnv merges at key level", () => {
    const mcp: WrapperConfig = { fixedEnv: { LOG: "info", TZ: "UTC" } };
    const tool: WrapperConfig = { fixedEnv: { LOG: "debug" } };
    expect(mergeWrapperConfig(mcp, tool).fixedEnv).toEqual({
      LOG: "debug",
      TZ: "UTC",
    });
  });

  it("command is built as commandPrefix ++ tool.command", () => {
    const mcp: WrapperConfig = { commandPrefix: ["docker", "exec", "db"] };
    const tool: WrapperConfig = { command: ["psql", "-c", "${input.query}"] };
    expect(mergeWrapperConfig(mcp, tool).command).toEqual([
      "docker",
      "exec",
      "db",
      "psql",
      "-c",
      "${input.query}",
    ]);
  });

  it("fixedParams merges at key level, tool wins", () => {
    const mcp: WrapperConfig = { fixedParams: { a: 1, b: 2 } };
    const tool: WrapperConfig = { fixedParams: { b: 20, c: 30 } };
    expect(mergeWrapperConfig(mcp, tool).fixedParams).toEqual({
      a: 1,
      b: 20,
      c: 30,
    });
  });
});

function mkRow(
  partial: Partial<WrapperRow> & { wrapperName: string },
): WrapperRow {
  return {
    mcpName: "test",
    underlyingToolName: null,
    kind: "mcp",
    level: 3,
    description: "",
    inputSchema: {},
    hidden: false,
    config: {},
    ...partial,
  };
}

function mkBaseline(name: string): ToolDefinition {
  return {
    name,
    description: "baseline desc",
    inputSchema: { type: "object" },
    level: 3,
  };
}

describe("composeListedTools", () => {
  it("returns baseline tools as passthrough when no rows", () => {
    const result = composeListedTools(
      [mkBaseline("foo"), mkBaseline("bar")],
      [],
    );
    expect(result.map((t) => t.name)).toEqual(["foo", "bar"]);
    expect(result[0].description).toBe("baseline desc");
  });

  it("same-name row overrides baseline metadata", () => {
    const rows = [
      mkRow({
        wrapperName: "foo",
        underlyingToolName: "foo",
        description: "nicer desc",
        level: 1,
      }),
    ];
    const result = composeListedTools([mkBaseline("foo")], rows);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("foo");
    expect(result[0].description).toBe("nicer desc");
    expect(result[0].level).toBe(1);
  });

  it("hidden same-name row removes baseline entirely", () => {
    const rows = [
      mkRow({
        wrapperName: "foo",
        underlyingToolName: "foo",
        hidden: true,
      }),
    ];
    const result = composeListedTools(
      [mkBaseline("foo"), mkBaseline("bar")],
      rows,
    );
    expect(result.map((t) => t.name)).toEqual(["bar"]);
  });

  it("N:1 wrappers all exposed alongside passthrough", () => {
    const rows = [
      mkRow({
        wrapperName: "cpu_usage",
        underlyingToolName: "query_prometheus",
        description: "cpu",
      }),
      mkRow({
        wrapperName: "mem_usage",
        underlyingToolName: "query_prometheus",
        description: "mem",
      }),
    ];
    const result = composeListedTools([mkBaseline("query_prometheus")], rows);
    expect(result.map((t) => t.name).sort()).toEqual([
      "cpu_usage",
      "mem_usage",
      "query_prometheus",
    ]);
  });

  it("N:1 wrappers with passthrough hidden", () => {
    const rows = [
      mkRow({
        wrapperName: "cpu_usage",
        underlyingToolName: "query_prometheus",
      }),
      mkRow({
        wrapperName: "query_prometheus",
        underlyingToolName: "query_prometheus",
        hidden: true,
      }),
    ];
    const result = composeListedTools([mkBaseline("query_prometheus")], rows);
    expect(result.map((t) => t.name)).toEqual(["cpu_usage"]);
  });

  it("cli/script rows exposed even without baseline", () => {
    const rows = [
      mkRow({
        wrapperName: "db_dump",
        kind: "cli",
        description: "dump db",
        level: 1,
      }),
    ];
    const result = composeListedTools([], rows);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("db_dump");
    expect(result[0].level).toBe(1);
  });

  it("hidden non-passthrough wrapper not emitted", () => {
    const rows = [
      mkRow({
        wrapperName: "cpu_usage",
        underlyingToolName: "query_prometheus",
        hidden: true,
      }),
    ];
    const result = composeListedTools([mkBaseline("query_prometheus")], rows);
    expect(result.map((t) => t.name)).toEqual(["query_prometheus"]);
  });

  it("inputSchema from row takes precedence when non-empty", () => {
    const rows = [
      mkRow({
        wrapperName: "foo",
        underlyingToolName: "foo",
        inputSchema: { type: "object", properties: { q: { type: "string" } } },
      }),
    ];
    const result = composeListedTools([mkBaseline("foo")], rows);
    expect(result[0].inputSchema).toEqual({
      type: "object",
      properties: { q: { type: "string" } },
    });
  });

  it("empty row description falls back to baseline", () => {
    const rows = [mkRow({ wrapperName: "foo", underlyingToolName: "foo" })];
    const result = composeListedTools([mkBaseline("foo")], rows);
    expect(result[0].description).toBe("baseline desc");
  });
});
