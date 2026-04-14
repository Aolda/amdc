import { describe, it, expect } from "vitest";
import {
  AgentDefaultPermissionChecker,
  AllowAllPermissionChecker,
} from "./permission.js";
import type {
  AgentLike,
  AllowListProvider,
  Mcp,
  SessionContext,
  ToolDefinition,
  ToolLevel,
} from "./types.js";

const ctx: SessionContext = {
  token: "t",
  sessionId: "s",
  agentId: "agent-1",
};

function makeMcp(name: string, defaultLevel: ToolLevel): Mcp {
  return {
    name,
    kind: "native",
    description: "",
    defaultLevel,
    listTools: async () => [],
    callTool: async () => ({ content: [{ type: "text", text: "" }] }),
  };
}

function makeTool(name: string, level: ToolLevel): ToolDefinition {
  return {
    name,
    description: "",
    inputSchema: { type: "object" },
    level,
  };
}

describe("AllowAllPermissionChecker", () => {
  it("allows everything", async () => {
    const c = new AllowAllPermissionChecker();
    const decision = await c.check(
      ctx,
      makeMcp("echo", 1),
      makeTool("echo", 1),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("AgentDefaultPermissionChecker", () => {
  function makeChecker(agent: AgentLike | null, allowList?: AllowListProvider) {
    return new AgentDefaultPermissionChecker({
      getAgent: async () => agent,
      allowListProvider: allowList,
    });
  }

  it("denies when agent not found", async () => {
    const c = makeChecker(null);
    const decision = await c.check(
      ctx,
      makeMcp("echo", 3),
      makeTool("echo", 3),
    );
    expect(decision.allowed).toBe(false);
  });

  it("denies when mcp not in agent's allow list", async () => {
    const c = makeChecker({ id: "agent-1", mcps: [] });
    const decision = await c.check(
      ctx,
      makeMcp("echo", 3),
      makeTool("echo", 3),
    );
    expect(decision.allowed).toBe(false);
  });

  it("allows when tool default level is 3", async () => {
    const c = makeChecker({
      id: "agent-1",
      mcps: [{ name: "echo", levelOverride: null, toolOverrides: [] }],
    });
    const decision = await c.check(
      ctx,
      makeMcp("echo", 3),
      makeTool("echo", 3),
    );
    expect(decision.allowed).toBe(true);
  });

  it("denies tool default level 2 when no approval", async () => {
    const c = makeChecker({
      id: "agent-1",
      mcps: [{ name: "risky", levelOverride: null, toolOverrides: [] }],
    });
    const decision = await c.check(
      ctx,
      makeMcp("risky", 2),
      makeTool("risky", 2),
    );
    expect(decision.allowed).toBe(false);
  });

  it("allows when mcp bulk override is 3", async () => {
    const c = makeChecker({
      id: "agent-1",
      mcps: [{ name: "risky", levelOverride: 3, toolOverrides: [] }],
    });
    const decision = await c.check(
      ctx,
      makeMcp("risky", 2),
      makeTool("risky", 2),
    );
    expect(decision.allowed).toBe(true);
  });

  it("denies when mcp bulk override is 1 even though tool default is 3", async () => {
    const c = makeChecker({
      id: "agent-1",
      mcps: [{ name: "echo", levelOverride: 1, toolOverrides: [] }],
    });
    const decision = await c.check(
      ctx,
      makeMcp("echo", 3),
      makeTool("echo", 3),
    );
    expect(decision.allowed).toBe(false);
  });

  it("tool override takes precedence over mcp bulk override", async () => {
    const c = makeChecker({
      id: "agent-1",
      mcps: [
        {
          name: "risky",
          levelOverride: 1,
          toolOverrides: [{ toolName: "safeRead", level: 3 }],
        },
      ],
    });
    const decision = await c.check(
      ctx,
      makeMcp("risky", 2),
      makeTool("safeRead", 2),
    );
    expect(decision.allowed).toBe(true);
  });

  it("tool override of 1 denies an otherwise level-3 tool", async () => {
    const c = makeChecker({
      id: "agent-1",
      mcps: [
        {
          name: "echo",
          levelOverride: null,
          toolOverrides: [{ toolName: "echo", level: 1 }],
        },
      ],
    });
    const decision = await c.check(
      ctx,
      makeMcp("echo", 3),
      makeTool("echo", 3),
    );
    expect(decision.allowed).toBe(false);
  });

  it("allows level 2 when allowList approves the specific tool", async () => {
    const approvingList: AllowListProvider = {
      isApproved: async (_c, mcp, tool) => mcp === "risky" && tool === "risky",
    };
    const c = makeChecker(
      {
        id: "agent-1",
        mcps: [{ name: "risky", levelOverride: null, toolOverrides: [] }],
      },
      approvingList,
    );
    const decision = await c.check(
      ctx,
      makeMcp("risky", 2),
      makeTool("risky", 2),
    );
    expect(decision.allowed).toBe(true);
  });
});
