import { describe, it, expect, beforeEach } from "vitest";
import { createDatabase, type DB } from "../db/index.js";
import { syncMcpsToDb } from "./mcp-sync.js";
import type { UpstreamMcpMeta } from "./types.js";
import {
  fetchMcpConfig,
  updateMcpConfig,
  fetchWrapperRow,
  fetchWrapperRows,
  insertWrapperRow,
  updateWrapperRow,
  deleteWrapperRow,
} from "./wrapper-repository.js";
import type { WrapperRow } from "./wrapper.js";

let db: DB;

const upstream: UpstreamMcpMeta = {
  name: "grafana",
  kind: "upstream",
  description: "",
  defaultLevel: 3,
  upstreamUrl: "http://x",
};

beforeEach(async () => {
  db = await createDatabase(":memory:");
  await syncMcpsToDb(db, [upstream]);
});

function mkRow(overrides: Partial<WrapperRow> = {}): WrapperRow {
  return {
    mcpName: "grafana",
    wrapperName: "cpu_usage",
    underlyingToolName: "query_prometheus",
    kind: "mcp",
    level: 2,
    description: "cpu",
    inputSchema: { type: "object" },
    hidden: false,
    config: { fixedParams: { query: "rate(cpu[5m])" } },
    ...overrides,
  };
}

describe("mcp config", () => {
  it("defaults to empty object when never set", async () => {
    expect(await fetchMcpConfig(db, "grafana")).toEqual({});
  });

  it("roundtrips mcp config", async () => {
    await updateMcpConfig(db, "grafana", {
      secrets: { API_KEY: "k" },
      routing: { staging: { host: "s" } },
    });
    const got = await fetchMcpConfig(db, "grafana");
    expect(got).toEqual({
      secrets: { API_KEY: "k" },
      routing: { staging: { host: "s" } },
    });
  });
});

describe("wrapper rows", () => {
  it("insert + fetch roundtrip", async () => {
    await insertWrapperRow(db, mkRow());
    const row = await fetchWrapperRow(db, "grafana", "cpu_usage");
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("mcp");
    expect(row!.underlyingToolName).toBe("query_prometheus");
    expect(row!.level).toBe(2);
    expect(row!.hidden).toBe(false);
    expect(row!.config.fixedParams).toEqual({ query: "rate(cpu[5m])" });
    expect(row!.inputSchema).toEqual({ type: "object" });
  });

  it("fetchWrapperRow returns null when missing", async () => {
    expect(await fetchWrapperRow(db, "grafana", "nope")).toBeNull();
  });

  it("fetchWrapperRows returns all rows for an mcp", async () => {
    await insertWrapperRow(db, mkRow({ wrapperName: "cpu_usage" }));
    await insertWrapperRow(db, mkRow({ wrapperName: "mem_usage" }));
    const rows = await fetchWrapperRows(db, "grafana");
    expect(rows.map((r) => r.wrapperName).sort()).toEqual([
      "cpu_usage",
      "mem_usage",
    ]);
  });

  it("updateWrapperRow replaces fields", async () => {
    await insertWrapperRow(db, mkRow());
    await updateWrapperRow(
      db,
      mkRow({
        level: 1,
        description: "critical cpu",
        hidden: true,
        config: { fixedParams: { query: "rate(cpu[1m])" } },
      }),
    );
    const row = await fetchWrapperRow(db, "grafana", "cpu_usage");
    expect(row!.level).toBe(1);
    expect(row!.description).toBe("critical cpu");
    expect(row!.hidden).toBe(true);
    expect(row!.config.fixedParams).toEqual({ query: "rate(cpu[1m])" });
  });

  it("deleteWrapperRow removes the row", async () => {
    await insertWrapperRow(db, mkRow());
    await deleteWrapperRow(db, "grafana", "cpu_usage");
    expect(await fetchWrapperRow(db, "grafana", "cpu_usage")).toBeNull();
  });
});
