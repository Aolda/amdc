import { fileURLToPath } from "node:url";
import { LangChainDiagnosticAgent } from "../agent/langchain-diagnostic-agent.js";
import { TemporaryDiagnosticPresenter } from "../report/temporary-diagnostic-presenter.js";
import type { DiagnosticRunnerContext } from "../diagnostic/types.js";
import { ConsoleDiagnosticTraceSink } from "../observability/diagnostic-trace.js";
import { loadToolCatalogFromYaml } from "../tools/catalog-loader.js";
import { PluginRegistry } from "../tools/plugin-registry.js";
import { YamlToolRuntime } from "../tools/yaml-tool-runtime.js";
import { DiagnosisPipeline } from "./diagnosis-pipeline.js";

interface ToolRuntimeBundle {
  readonly registry: PluginRegistry;
  readonly runtime: YamlToolRuntime;
}

let toolRuntimeBundle: ToolRuntimeBundle | null = null;
const pipelines = new Map<string, DiagnosisPipeline>();
const diagnosticTraceSink = new ConsoleDiagnosticTraceSink();

export function createDiagnosisPipeline(context: DiagnosticRunnerContext): DiagnosisPipeline {
  const key = `${context.runnerMode}:${context.agentModel}`;
  const cached = pipelines.get(key);

  if (cached) {
    return cached;
  }

  const bundle = getToolRuntimeBundle();
  const pipeline = new DiagnosisPipeline(
    new LangChainDiagnosticAgent(bundle.registry, bundle.runtime, {
      model: context.agentModel,
      apiKey: requireOpenAiApiKey(context),
      baseUrl: context.openaiBaseUrl,
      traceSink: diagnosticTraceSink
    }),
    new TemporaryDiagnosticPresenter()
  );
  pipelines.set(key, pipeline);
  return pipeline;
}

function getToolRuntimeBundle(): ToolRuntimeBundle {
  if (toolRuntimeBundle) {
    return toolRuntimeBundle;
  }

  const catalog = loadToolCatalogFromYaml(
    fileURLToPath(new URL("../tools/catalogs/amdb-tools.yaml", import.meta.url))
  );
  const registry = new PluginRegistry(catalog);
  const runtime = new YamlToolRuntime(registry);

  toolRuntimeBundle = { registry, runtime };
  return toolRuntimeBundle;
}

function requireOpenAiApiKey(context: DiagnosticRunnerContext): string {
  if (!context.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required for AMDC_DIAGNOSTIC_RUNNER=langchain.");
  }

  return context.openaiApiKey;
}
