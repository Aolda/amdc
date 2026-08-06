import { tool } from "@langchain/core/tools";
import type { AmdcEnvironment } from "../config/env.js";
import { jsonObjectSchemaToZod } from "./langchain-schemas.js";
import type { AgentVisibleToolDescriptor, ToolRuntime } from "../tools/types.js";

export interface LangChainToolWrapperContext {
  readonly environment: AmdcEnvironment;
  readonly referenceTime: Date;
}

export function createAmdcLangChainTools(
  descriptors: readonly AgentVisibleToolDescriptor[],
  runtime: ToolRuntime,
  context: LangChainToolWrapperContext
) {
  return descriptors.map((descriptor) =>
    tool(
      async (args: Record<string, unknown>) => {
        const result = await runtime.execute(
          {
            toolName: descriptor.name,
            args
          },
          {
            environment: context.environment,
            referenceTime: context.referenceTime
          }
        );

        return JSON.stringify(result);
      },
      {
        name: descriptor.name,
        description: [
          descriptor.description,
          "This is an AMDC read-only tool. Use it only to inspect current AMDB infrastructure state.",
          "The tool returns sanitized ToolObservation or SanitizedToolError JSON."
        ].join(" "),
        schema: jsonObjectSchemaToZod(descriptor.inputSchema)
      }
    )
  );
}
