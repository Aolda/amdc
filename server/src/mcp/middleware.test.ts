import { describe, it, expect, vi } from "vitest";
import type { ToolCallResult, ToolDefinition } from "./types.js";
import {
  composeMiddleware,
  type Middleware,
  type ToolCallContext,
  type ToolCallNext,
} from "./middleware/types.js";
import { authMiddleware } from "./middleware/auth.js";
import { envMiddleware } from "./middleware/env.js";
import { fixedParamsMiddleware } from "./middleware/fixed-params.js";
import { secretMaskMiddleware } from "./middleware/secret-mask.js";
import { logMiddleware } from "./middleware/log.js";

const ok: ToolCallResult = {
  content: [{ type: "text", text: "ok" }],
};

function mkCtx(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  const def: ToolDefinition = {
    name: "test_tool",
    description: "",
    inputSchema: {},
    level: 3,
  };
  const mcp = {
    name: "test_mcp",
    kind: "native" as const,
    description: "",
    defaultLevel: 3,
    listTools: async () => [def],
    callTool: async () => ok,
  };
  return {
    session: { token: "t", sessionId: "s", agentId: "a" },
    tool: { mcp, definition: def, row: null },
    input: {},
    mergedConfig: {},
    namespaces: { input: {} },
    ...overrides,
  };
}

const passthrough: ToolCallNext = async () => ok;

describe("composeMiddleware", () => {
  it("runs middlewares in order", async () => {
    const order: string[] = [];
    const mw1: Middleware = async (ctx, next) => {
      order.push("mw1-before");
      const r = await next(ctx);
      order.push("mw1-after");
      return r;
    };
    const mw2: Middleware = async (ctx, next) => {
      order.push("mw2-before");
      const r = await next(ctx);
      order.push("mw2-after");
      return r;
    };
    const final: ToolCallNext = async () => {
      order.push("final");
      return ok;
    };
    const chain = composeMiddleware([mw1, mw2], final);
    await chain(mkCtx());
    expect(order).toEqual([
      "mw1-before",
      "mw2-before",
      "final",
      "mw2-after",
      "mw1-after",
    ]);
  });

  it("short-circuits when middleware does not call next", async () => {
    const blocker: Middleware = async () => ({
      content: [{ type: "text", text: "blocked" }],
      isError: true,
    });
    const chain = composeMiddleware([blocker], passthrough);
    const result = await chain(mkCtx());
    expect(result.isError).toBe(true);
  });
});

describe("authMiddleware", () => {
  it("passes when checker allows", async () => {
    const checker = {
      check: async () => ({ allowed: true }),
    };
    const mw = authMiddleware(checker);
    const result = await mw(mkCtx(), passthrough);
    expect(result.isError).toBeFalsy();
  });

  it("blocks when checker denies", async () => {
    const checker = {
      check: async () => ({ allowed: false, reason: "nope" }),
    };
    const mw = authMiddleware(checker);
    const result = await mw(mkCtx(), passthrough);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("nope");
  });
});

describe("envMiddleware", () => {
  it("populates secret/route/ctx namespaces", async () => {
    const ctx = mkCtx({
      session: {
        token: "t",
        sessionId: "s-1",
        agentId: "monitor",
        environment: "prod",
      },
      mergedConfig: {
        secrets: { API_KEY: "k" },
        routing: { prod: { host: "db.prod" } },
      },
    });
    let captured: ToolCallContext | null = null;
    const spy: ToolCallNext = async (c) => {
      captured = c;
      return ok;
    };
    await envMiddleware()(ctx, spy);
    expect(captured).not.toBeNull();
    expect(captured!.namespaces.secret).toEqual({ API_KEY: "k" });
    expect(captured!.namespaces.route).toEqual({ host: "db.prod" });
    expect(captured!.namespaces.ctx).toMatchObject({ environment: "prod" });
  });
});

describe("fixedParamsMiddleware", () => {
  it("merges fixedParams into input", async () => {
    const ctx = mkCtx({
      input: { query: "SELECT 1" },
      mergedConfig: { fixedParams: { format: "json", limit: 100 } },
    });
    let captured: ToolCallContext | null = null;
    const spy: ToolCallNext = async (c) => {
      captured = c;
      return ok;
    };
    await fixedParamsMiddleware()(ctx, spy);
    expect(captured!.input).toEqual({
      query: "SELECT 1",
      format: "json",
      limit: 100,
    });
  });

  it("fixedParams override agent input on conflict", async () => {
    const ctx = mkCtx({
      input: { x: "agent" },
      mergedConfig: { fixedParams: { x: "fixed" } },
    });
    let captured: ToolCallContext | null = null;
    const spy: ToolCallNext = async (c) => {
      captured = c;
      return ok;
    };
    await fixedParamsMiddleware()(ctx, spy);
    expect(captured!.input.x).toBe("fixed");
  });
});

describe("secretMaskMiddleware", () => {
  it("masks secret values in output text", async () => {
    const ctx = mkCtx({ mergedConfig: { secrets: { K: "abc123" } } });
    const downstream: ToolCallNext = async () => ({
      content: [{ type: "text", text: "key=abc123 done" }],
    });
    const result = await secretMaskMiddleware()(ctx, downstream);
    expect(result.content[0].text).toBe("key=*** done");
  });

  it("passes through when no secrets", async () => {
    const result = await secretMaskMiddleware()(mkCtx(), passthrough);
    expect(result.content[0].text).toBe("ok");
  });
});

describe("logMiddleware", () => {
  it("logs tool name and duration", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await logMiddleware()(mkCtx(), passthrough);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toContain("test_tool");
    spy.mockRestore();
  });
});
