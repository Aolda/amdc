import { tool } from "@langchain/core/tools";
import { localToolDetails } from "../observability/local-tool-details.js";
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
  // One set per diagnosis; reserve synchronously before parallel tool execution.
  const executed = new Set<string>();
  const attemptsByTool = new Map<string, number>();
  let tail: Promise<unknown> = Promise.resolve();
  return descriptors.map((descriptor) => {
    const wrapped = tool(
      async (args: Record<string, unknown>) => {
        const startedAt = Date.now();
        await context.traceSink.record({
          event: "tool.started",
          runId: context.runId,
          occurredAt: new Date().toISOString(),
          plugin: descriptor.pluginName,
          tool: descriptor.name,
          ...(["mysql", "prometheus"].includes(descriptor.pluginName) ? localToolDetails(context.environment, args) : {})
        });

        const key = JSON.stringify([descriptor.name, Object.entries(args).sort(([a], [b]) => a.localeCompare(b))]);
        const duplicate = executed.has(key);
        executed.add(key);
        const result = duplicate ? {
          ok: false as const,
          error: {
            toolName: descriptor.name,
            pluginName: descriptor.pluginName,
            code: "invalid_input" as const,
            message: "Identical tool input was already requested in this diagnosis. Use its earlier result; choose a different query or finish with the available evidence.",
            occurredAt: new Date().toISOString()
          }
        } : await runtime.execute(
          {
            toolName: descriptor.name,
            args
          },
          {
            environment: context.environment,
            referenceTime: context.referenceTime
          }
        ).catch(() => ({
          ok: false as const,
          error: { toolName: descriptor.name, pluginName: descriptor.pluginName,
            code: "source_request_failed" as const, message: "Tool execution failed unexpectedly.",
            occurredAt: new Date().toISOString() }
        }));

        await context.traceSink.record({
          event: "tool.finished",
          runId: context.runId,
          occurredAt: new Date().toISOString(),
          plugin: descriptor.pluginName,
          tool: descriptor.name,
          durationMs: Date.now() - startedAt,
          outcome: result.ok ? "succeeded" : "failed",
          ...(["mysql", "prometheus"].includes(descriptor.pluginName) ? localToolDetails(context.environment, args, result) : {}),
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
    );
    const invoke = wrapped.invoke.bind(wrapped);
    wrapped.invoke = (input, config) => {
      // Count by tool identity, independent of arguments, before any await.
      const attempts = (attemptsByTool.get(descriptor.name) ?? 0) + 1;
      attemptsByTool.set(descriptor.name, attempts);
      if (attempts > 8) {
        return Promise.reject(new Error("per_tool_call_budget_exhausted"));
      }
      const pending = tail.then(() => invoke(input, config));
      tail = pending.then(() => undefined, () => undefined);
      return pending;
    };
    return wrapped;
  });
}
