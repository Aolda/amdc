import { describe, it, expect } from "vitest";
import { createSessionRegistry } from "./session-registry.js";

describe("session registry", () => {
  it("issues a token with generated session id", () => {
    const reg = createSessionRegistry();
    const ctx = reg.issueToken({ agentId: "agent-1" });
    expect(ctx.token).toMatch(/\S/);
    expect(ctx.sessionId).toMatch(/\S/);
    expect(ctx.agentId).toBe("agent-1");
  });

  it("resolves a previously issued token", () => {
    const reg = createSessionRegistry();
    const issued = reg.issueToken({ agentId: "agent-1" });
    const resolved = reg.resolve(issued.token);
    expect(resolved).toEqual(issued);
  });

  it("returns null for unknown token", () => {
    const reg = createSessionRegistry();
    expect(reg.resolve("no-such-token")).toBeNull();
  });

  it("revokes a token so resolve returns null", () => {
    const reg = createSessionRegistry();
    const issued = reg.issueToken({ agentId: "a" });
    reg.revoke(issued.token);
    expect(reg.resolve(issued.token)).toBeNull();
  });

  it("generates distinct tokens for distinct issuances", () => {
    const reg = createSessionRegistry();
    const a = reg.issueToken({ agentId: "a" });
    const b = reg.issueToken({ agentId: "a" });
    expect(a.token).not.toBe(b.token);
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});
