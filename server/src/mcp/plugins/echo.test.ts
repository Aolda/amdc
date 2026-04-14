import { describe, it, expect } from "vitest";
import { echoMeta } from "./echo.js";

describe("echo mcp", () => {
  it("exposes echo tool meta", () => {
    expect(echoMeta.name).toBe("echo");
    expect(echoMeta.defaultLevel).toBe(3);
    expect(echoMeta.tools).toHaveLength(1);
    expect(echoMeta.tools[0].name).toBe("echo");
  });

  it("loaded handler echoes message input", async () => {
    const mod = await echoMeta.loadHandler();
    const result = await mod.default(
      "echo",
      { message: "hi" },
      { token: "t", sessionId: "s", agentId: "a" },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toEqual({ type: "text", text: "hi" });
  });

  it("returns error for unknown tool name", async () => {
    const mod = await echoMeta.loadHandler();
    const result = await mod.default(
      "other",
      { message: "hi" },
      { token: "t", sessionId: "s", agentId: "a" },
    );
    expect(result.isError).toBe(true);
  });
});
