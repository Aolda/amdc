import { describe, it, expect } from "vitest";
import { runCliTool, type CliRunner } from "./runner.js";
import type { WrapperRow } from "../../wrapper.js";
import type { SessionContext } from "../../types.js";

const ctx: SessionContext = {
  token: "t",
  sessionId: "s-1",
  agentId: "monitor",
};

function mkRunner(
  fn: (args: {
    command: string;
    argv: string[];
    env: Record<string, string>;
  }) => Promise<{ stdout: string; stderr: string; code: number }>,
): CliRunner {
  return fn;
}

function mkRow(
  partial: Partial<WrapperRow> & { wrapperName: string },
): WrapperRow {
  return {
    mcpName: "amdb_cli",
    underlyingToolName: null,
    kind: "cli",
    level: 2,
    description: "",
    inputSchema: {},
    hidden: false,
    config: {},
    ...partial,
  };
}

describe("runCliTool", () => {
  it("interpolates command array and returns stdout as text content", async () => {
    let captured: { command: string; argv: string[] } | null = null;
    const runner = mkRunner(async ({ command, argv }) => {
      captured = { command, argv };
      return { stdout: "rows: 1\n", stderr: "", code: 0 };
    });
    const row = mkRow({
      wrapperName: "query",
      config: {
        command: ["psql", "-h", "${route.host}", "-c", "${input.query}"],
        routing: { staging: { host: "db-staging.local" } },
      },
    });
    const result = await runCliTool(
      row,
      { query: "SELECT 1" },
      { ...ctx, environment: "staging" },
      runner,
    );
    expect(captured).not.toBeNull();
    expect(captured!.command).toBe("psql");
    expect(captured!.argv).toEqual([
      "-h",
      "db-staging.local",
      "-c",
      "SELECT 1",
    ]);
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toEqual({ type: "text", text: "rows: 1\n" });
  });

  it("injects fixedEnv with interpolated secrets", async () => {
    let capturedEnv: Record<string, string> = {};
    const runner = mkRunner(async ({ env }) => {
      capturedEnv = env;
      return { stdout: "", stderr: "", code: 0 };
    });
    const row = mkRow({
      wrapperName: "dump",
      config: {
        command: ["pg_dump"],
        secrets: { TOKEN: "tok-xyz" },
        fixedEnv: { PGTOKENWORD: "${secret.TOKEN}", PGSSLMODE: "require" },
      },
    });
    await runCliTool(row, {}, { ...ctx, environment: "prod" }, runner);
    expect(capturedEnv.PGTOKENWORD).toBe("tok-xyz");
    expect(capturedEnv.PGSSLMODE).toBe("require");
  });

  it("returns isError=true on non-zero exit", async () => {
    const runner = mkRunner(async () => ({
      stdout: "",
      stderr: "boom",
      code: 2,
    }));
    const row = mkRow({ wrapperName: "x", config: { command: ["false"] } });
    const result = await runCliTool(
      row,
      {},
      { ...ctx, environment: "staging" },
      runner,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
  });

  it("masks secret values in stdout/stderr", async () => {
    const runner = mkRunner(async () => ({
      stdout: "connected as ro with tok-xyz",
      stderr: "",
      code: 0,
    }));
    const row = mkRow({
      wrapperName: "query",
      config: {
        command: ["echo"],
        secrets: { USER: "ro", TOKEN: "tok-xyz" },
      },
    });
    const result = await runCliTool(
      row,
      {},
      { ...ctx, environment: "staging" },
      runner,
    );
    expect(result.content[0].text).toBe("connected as *** with ***");
  });

  it("throws when command is empty", async () => {
    const runner = mkRunner(async () => ({ stdout: "", stderr: "", code: 0 }));
    const row = mkRow({ wrapperName: "x", config: {} });
    await expect(
      runCliTool(row, {}, { ...ctx, environment: "staging" }, runner),
    ).rejects.toThrow(/command/);
  });
});
