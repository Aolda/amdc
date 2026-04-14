import type { NativeHandler } from "../types.js";

if (typeof globalThis !== "undefined") {
  (globalThis as Record<string, unknown>).__amdcEchoHandlerLoaded = true;
}

const echoHandler: NativeHandler = async (toolName, input) => {
  if (toolName !== "echo") {
    return {
      content: [{ type: "text", text: `unknown tool: ${toolName}` }],
      isError: true,
    };
  }
  const message =
    typeof (input as { message?: unknown })?.message === "string"
      ? (input as { message: string }).message
      : "";
  return {
    content: [{ type: "text", text: message }],
  };
};

export default echoHandler;
