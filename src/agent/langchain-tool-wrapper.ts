import { tool } from "@langchain/core/tools";
import type { AmdcEnvironment } from "../config/env.js";
import type { DiagnosticTraceSink } from "../observability/diagnostic-trace.js";
import { jsonObjectSchemaToZod } from "./langchain-schemas.js";
import type { AgentVisibleToolDescriptor, ToolRuntime } from "../tools/types.js";

export interface LangChainToolWrapperContext {
  readonly environment: AmdcEnvironment;
  readonly referenceTime: Date;
  readonly runId: string;
  readonly traceSink: DiagnosticTraceSink;
}

export function createAmdcLangChainTools(
  descriptors: readonly AgentVisibleToolDescriptor[],
  runtime: ToolRuntime,
  context: LangChainToolWrapperContext
) {
  return descriptors.map((descriptor) =>
    tool(
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        await context.traceSink.record({
          event: "tool.started",
          runId: context.runId,
          occurredAt: new Date().toISOString(),
          plugin: descriptor.pluginName,
          tool: descriptor.name
        });

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

        await context.traceSink.record({
          event: "tool.finished",
          runId: context.runId,
          occurredAt: new Date().toISOString(),
          plugin: descriptor.pluginName,
          tool: descriptor.name,
          durationMs: Date.now() - startedAt,
          outcome: result.ok ? "succeeded" : "failed",
          ...(result.ok &&
          "rawResult" in result &&
          result.rawResult.transport === "local_shell"
            ? { exitCode: result.rawResult.execution.exitCode }
            : {}),
          ...(!result.ok ? { errorCode: result.error.code } : {})
        });

        return JSON.stringify(result);
      },
      {
        name: descriptor.name,
        description: descriptor.description,
        schema: jsonObjectSchemaToZod(descriptor.inputSchema)
      }
    )
  );
}
