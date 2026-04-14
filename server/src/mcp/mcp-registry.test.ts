import { describe, it, expect, vi } from "vitest";
import { createMcpRegistry } from "./mcp-registry.js";
import type { NativeHandler, NativeMcpMeta, SessionContext } from "./types.js";

const ctx: SessionContext = {
  token: "t",
  sessionId: "s",
  agentId: "a",
};

function makeMeta(loadHandler: NativeMcpMeta["loadHandler"]): NativeMcpMeta {
  return {
    name: "dummy",
    kind: "native",
    description: "d",
    defaultLevel: 3,
    tools: [
      {
        name: "dummy",
        description: "d",
        inputSchema: { type: "object", properties: {} },
      },
    ],
    loadHandler,
  };
}

describe("mcp registry", () => {
  it("lists mcps from metas", () => {
    const reg = createMcpRegistry([
      makeMeta(async () => ({
        default: (async () => ({
          content: [{ type: "text", text: "" }],
        })) as NativeHandler,
      })),
    ]);
    const mcps = reg.listMcps();
    expect(mcps).toHaveLength(1);
    expect(mcps[0].name).toBe("dummy");
    expect(mcps[0].defaultLevel).toBe(3);
  });

  it("does not load handler module until first callTool", async () => {
    const loadHandler = vi.fn(async () => ({
      default: (async (_n, _i, _c) => ({
        content: [{ type: "text", text: "ok" }],
      })) as NativeHandler,
    }));
    const reg = createMcpRegistry([makeMeta(loadHandler)]);
    // listMcps and listTools should NOT trigger loadHandler
    reg.listMcps();
    const tools = await reg.findMcp("dummy")!.listTools();
    expect(tools).toHaveLength(1);
    expect(loadHandler).not.toHaveBeenCalled();

    await reg.findMcp("dummy")!.callTool("dummy", {}, ctx);
    expect(loadHandler).toHaveBeenCalledTimes(1);
  });

  it("caches handler module across multiple callTool invocations", async () => {
    const loadHandler = vi.fn(async () => ({
      default: (async () => ({
        content: [{ type: "text", text: "ok" }],
      })) as NativeHandler,
    }));
    const reg = createMcpRegistry([makeMeta(loadHandler)]);
    const mcp = reg.findMcp("dummy")!;
    await mcp.callTool("dummy", {}, ctx);
    await mcp.callTool("dummy", {}, ctx);
    await mcp.callTool("dummy", {}, ctx);
    expect(loadHandler).toHaveBeenCalledTimes(1);
  });

  it("returns null for unknown mcp name", () => {
    const reg = createMcpRegistry([]);
    expect(reg.findMcp("nope")).toBeNull();
  });

  it("aggregates tools across all mcps via listAllTools", async () => {
    const meta1 = makeMeta(async () => ({
      default: (async () => ({
        content: [{ type: "text", text: "" }],
      })) as NativeHandler,
    }));
    const meta2: NativeMcpMeta = {
      ...makeMeta(async () => ({
        default: (async () => ({
          content: [{ type: "text", text: "" }],
        })) as NativeHandler,
      })),
      name: "other",
      tools: [
        {
          name: "other",
          description: "",
          inputSchema: { type: "object" },
        },
      ],
    };
    const reg = createMcpRegistry([meta1, meta2]);
    const all = await reg.listAllTools();
    expect(all.map((t) => t.name).sort()).toEqual(["dummy", "other"]);
  });
});
