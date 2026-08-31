import { ToolMessage } from "@langchain/core/messages";
import type { ClientTool, ServerTool, ToolRuntime as LangChainToolRuntime } from "@langchain/core/tools";
import { tool } from "@langchain/core/tools";
import { Command } from "@langchain/langgraph";
import { createMiddleware } from "langchain";
import { z } from "zod/v3";
import type { DiagnosticTraceSink } from "../observability/diagnostic-trace.js";
import { toSafeErrorMetadata } from "../observability/safe-error-metadata.js";
import { PluginRegistry } from "../tools/plugin-registry.js";
import type { PluginName } from "../tools/types.js";

export const PLUGIN_SELECTION_TOOL_NAME = "select_plugin";

const pluginSelectionStateSchema = z.object({
  activePlugin: z.string().nullable().default(null),
  visitedPlugins: z.array(z.string()).default([])
});

type PluginSelectionState = z.infer<typeof pluginSelectionStateSchema>;
type LangChainAgentTool = ClientTool | ServerTool;

export interface PluginLazyLoadingTraceContext {
  readonly runId: string;
  readonly traceSink: DiagnosticTraceSink;
}

export function createPluginLazyLoadingMiddleware(
  registry: PluginRegistry,
  traceContext?: PluginLazyLoadingTraceContext
) {
  let modelCallIndex = 0;
  const pluginNames = registry.listPlugins().map((plugin) => plugin.name);
  const pluginNameSchema = z.enum(
    pluginNames as [PluginName, ...PluginName[]]
  );

  const selectPlugin = tool(
    async ({ pluginName }, runtime: LangChainToolRuntime<PluginSelectionState>) => {
      const nextState = createNextPluginSelectionState(
        registry,
        runtime.state.visitedPlugins ?? [],
        pluginName
      );

      await traceContext?.traceSink.record({
        event: "plugin.selected",
        runId: traceContext.runId,
        occurredAt: new Date().toISOString(),
        plugin: pluginName
      });

      return new Command({
        update: {
          ...nextState,
          messages: [
            new ToolMessage({
              name: PLUGIN_SELECTION_TOOL_NAME,
              tool_call_id: runtime.toolCallId,
              content: JSON.stringify(
                createPluginSelectionPayload(registry, pluginName)
              )
            })
          ]
        }
      });
    },
    {
      name: PLUGIN_SELECTION_TOOL_NAME,
      description: [
        "Load one AMDC diagnostic plugin when its domain is relevant to the current symptom or evidence.",
        "The result lists the read-only tools that become available for the selected plugin.",
        "Select the smallest relevant plugin first and expand only when evidence requires another domain."
      ].join(" "),
      schema: z.object({
        pluginName: pluginNameSchema.describe("AMDC plugin to load")
      })
    }
  );

  return createMiddleware({
    name: "AmdcPluginLazyLoading",
    stateSchema: pluginSelectionStateSchema,
    tools: [selectPlugin],
    wrapModelCall: async (request, handler) => {
      const currentModelCallIndex = ++modelCallIndex;
      const startedAt = Date.now();
      const activePlugin =
        normalizePluginNames(
          request.state.activePlugin ? [request.state.activePlugin] : [],
          registry
        )[0] ?? null;
      const visibleTools = filterToolsForActivePlugin(
        request.tools,
        registry,
        activePlugin
      );

      await traceContext?.traceSink.record({
        event: "model.called",
        runId: traceContext.runId,
        occurredAt: new Date().toISOString(),
        modelCallIndex: currentModelCallIndex,
        activePlugin,
        tools: visibleTools.flatMap((availableTool) =>
          typeof availableTool === "object" &&
          "name" in availableTool &&
          typeof availableTool.name === "string"
            ? [availableTool.name]
            : []
        )
      });

      try {
        const result = await handler({
          ...request,
          tools: visibleTools
        });

        await traceContext?.traceSink.record({
          event: "model.finished",
          runId: traceContext.runId,
          occurredAt: new Date().toISOString(),
          modelCallIndex: currentModelCallIndex,
          activePlugin,
          durationMs: Date.now() - startedAt
        });

        return result;
      } catch (error) {
        await traceContext?.traceSink.record({
          event: "model.failed",
          runId: traceContext.runId,
          occurredAt: new Date().toISOString(),
          modelCallIndex: currentModelCallIndex,
          activePlugin,
          durationMs: Date.now() - startedAt,
          errorName: error instanceof Error ? error.name : "UnknownError",
          errorStage: "model_call",
          errorDetails: toSafeErrorMetadata(error)
        });
        throw error;
      }
    },
    wrapToolCall: (request, handler) => {
      if (request.toolCall.name === PLUGIN_SELECTION_TOOL_NAME) {
        return handler(request);
      }

      const definition = registry.getTool(request.toolCall.name);
      const activePlugin = request.state.activePlugin ?? null;

      if (definition && definition.pluginName !== activePlugin) {
        return new ToolMessage({
          name: request.toolCall.name,
          tool_call_id: request.toolCall.id ?? "unknown_tool_call",
          content: JSON.stringify({
            ok: false,
            error: {
              code: "plugin_not_selected",
              message: "Select the tool's plugin before requesting this diagnostic tool."
            }
          })
        });
      }

      return handler(request);
    }
  });
}

export function createNextPluginSelectionState(
  registry: PluginRegistry,
  visitedPlugins: readonly string[],
  nextPlugin: PluginName
) {
  return {
    activePlugin: nextPlugin,
    visitedPlugins: normalizePluginNames(
      [...visitedPlugins, nextPlugin],
      registry
    )
  };
}

export function createPluginSelectionPayload(
  registry: PluginRegistry,
  pluginName: PluginName
) {
  return {
    selectedPlugin: pluginName,
    loadedTools: registry.listToolsForPlugins([pluginName]).map((loadedTool) => ({
      name: loadedTool.name,
      description: loadedTool.description,
      inputSchema: loadedTool.inputSchema,
      readOnly: loadedTool.readOnly
    }))
  };
}

export function filterToolsForActivePlugin<T extends LangChainAgentTool>(
  tools: readonly T[],
  registry: PluginRegistry,
  activePlugin: string | null
): T[] {
  const selected = normalizePluginNames(
    activePlugin === null ? [] : [activePlugin],
    registry
  );
  const visibleToolNames = new Set(
    registry.listToolsForPlugins(selected).map((descriptor) => descriptor.name)
  );
  visibleToolNames.add(PLUGIN_SELECTION_TOOL_NAME);

  return tools.filter(
    (availableTool) =>
      typeof availableTool === "object" &&
      "name" in availableTool &&
      typeof availableTool.name === "string" &&
      visibleToolNames.has(availableTool.name)
  );
}

function normalizePluginNames(
  pluginNames: readonly string[],
  registry: PluginRegistry
): PluginName[] {
  const allowed = new Set<PluginName>(
    registry.listPlugins().map((plugin) => plugin.name)
  );

  return [...new Set(pluginNames)].filter((pluginName): pluginName is PluginName =>
    allowed.has(pluginName as PluginName)
  );
}
