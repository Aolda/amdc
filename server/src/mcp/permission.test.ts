import { describe, it, expect } from "vitest";
import {
  AgentDefaultPermissionChecker,
  AllowAllPermissionChecker,
} from "./permission.js";
import type {
  AgentLike,
  AllowListProvider,
  Plugin,
  SessionContext,
} from "./types.js";

const ctx: SessionContext = {
  token: "t",
  sessionId: "s",
  agentId: "agent-1",
};

function makePlugin(name: string, defaultLevel: 1 | 2 | 3): Plugin {
  return {
    name,
    kind: "native",
    description: "",
    defaultLevel,
    listTools: async () => [],
    callTool: async () => ({ content: [{ type: "text", text: "" }] }),
  };
}

describe("AllowAllPermissionChecker", () => {
  it("allows everything", async () => {
    const c = new AllowAllPermissionChecker();
    const decision = await c.check(ctx, makePlugin("echo", 1), "echo");
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
    const decision = await c.check(ctx, makePlugin("echo", 3), "echo");
    expect(decision.allowed).toBe(false);
  });

  it("denies when plugin not in agent's allow list", async () => {
    const c = makeChecker({ id: "agent-1", plugins: [] });
    const decision = await c.check(ctx, makePlugin("echo", 3), "echo");
    expect(decision.allowed).toBe(false);
  });

  it("allows when plugin level 3 is selected", async () => {
    const c = makeChecker({
      id: "agent-1",
      plugins: [{ name: "echo", levelOverride: null }],
    });
    const decision = await c.check(ctx, makePlugin("echo", 3), "echo");
    expect(decision.allowed).toBe(true);
  });

  it("denies level 2 plugin when no approval", async () => {
    const c = makeChecker({
      id: "agent-1",
      plugins: [{ name: "risky", levelOverride: null }],
    });
    const decision = await c.check(ctx, makePlugin("risky", 2), "risky");
    expect(decision.allowed).toBe(false);
  });

  it("allows level 2 plugin when override is 3", async () => {
    const c = makeChecker({
      id: "agent-1",
      plugins: [{ name: "risky", levelOverride: 3 }],
    });
    const decision = await c.check(ctx, makePlugin("risky", 2), "risky");
    expect(decision.allowed).toBe(true);
  });

  it("denies level 3 plugin when override is 1", async () => {
    const c = makeChecker({
      id: "agent-1",
      plugins: [{ name: "echo", levelOverride: 1 }],
    });
    const decision = await c.check(ctx, makePlugin("echo", 3), "echo");
    expect(decision.allowed).toBe(false);
  });

  it("allows level 2 when allowList approves specific tool", async () => {
    const approvingList: AllowListProvider = {
      isApproved: async (_c, plugin, tool) =>
        plugin === "risky" && tool === "risky",
    };
    const c = makeChecker(
      {
        id: "agent-1",
        plugins: [{ name: "risky", levelOverride: null }],
      },
      approvingList,
    );
    const decision = await c.check(ctx, makePlugin("risky", 2), "risky");
    expect(decision.allowed).toBe(true);
  });
});
