import type { NativePluginMeta } from "../types.js";

export const echoMeta: NativePluginMeta = {
  name: "echo",
  kind: "native",
  description: "Returns the input message; used for proxy_mcp smoke testing.",
  defaultLevel: 3,
  tools: [
    {
      name: "echo",
      description: "Echo back the provided message string.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "Message to echo back" },
        },
        required: ["message"],
        additionalProperties: false,
      },
    },
  ],
  loadHandler: () => import("./echo-handler.js"),
};
