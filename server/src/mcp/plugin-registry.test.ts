import { describe, it, expect, vi } from "vitest";
import { createPluginRegistry } from "./plugin-registry.js";
import type {
  NativeHandler,
  NativePluginMeta,
  SessionContext,
} from "./types.js";

const ctx: SessionContext = {
  token: "t",
  sessionId: "s",
  agentId: "a",
};

function makeMeta(
  loadHandler: NativePluginMeta["loadHandler"],
): NativePluginMeta {
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

describe("plugin registry", () => {
  it("lists plugins from metas", () => {
    const reg = createPluginRegistry([
      makeMeta(async () => ({
        default: (async () => ({
          content: [{ type: "text", text: "" }],
        })) as NativeHandler,
      })),
    ]);
    const plugins = reg.listPlugins();
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("dummy");
    expect(plugins[0].defaultLevel).toBe(3);
  });

  it("does not load handler module until first callTool", async () => {
    const loadHandler = vi.fn(async () => ({
      default: (async (_n, _i, _c) => ({
        content: [{ type: "text", text: "ok" }],
      })) as NativeHandler,
    }));
    const reg = createPluginRegistry([makeMeta(loadHandler)]);
    // listPlugins and listTools should NOT trigger loadHandler
    reg.listPlugins();
    const tools = await reg.findPlugin("dummy")!.listTools();
    expect(tools).toHaveLength(1);
    expect(loadHandler).not.toHaveBeenCalled();

    await reg.findPlugin("dummy")!.callTool("dummy", {}, ctx);
    expect(loadHandler).toHaveBeenCalledTimes(1);
  });

  it("caches handler module across multiple callTool invocations", async () => {
    const loadHandler = vi.fn(async () => ({
      default: (async () => ({
        content: [{ type: "text", text: "ok" }],
      })) as NativeHandler,
    }));
    const reg = createPluginRegistry([makeMeta(loadHandler)]);
    const plugin = reg.findPlugin("dummy")!;
    await plugin.callTool("dummy", {}, ctx);
    await plugin.callTool("dummy", {}, ctx);
    await plugin.callTool("dummy", {}, ctx);
    expect(loadHandler).toHaveBeenCalledTimes(1);
  });

  it("returns null for unknown plugin name", () => {
    const reg = createPluginRegistry([]);
    expect(reg.findPlugin("nope")).toBeNull();
  });

  it("aggregates tools across all plugins via listAllTools", async () => {
    const meta1 = makeMeta(async () => ({
      default: (async () => ({
        content: [{ type: "text", text: "" }],
      })) as NativeHandler,
    }));
    const meta2: NativePluginMeta = {
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
    const reg = createPluginRegistry([meta1, meta2]);
    const all = await reg.listAllTools();
    expect(all.map((t) => t.name).sort()).toEqual(["dummy", "other"]);
  });
});
