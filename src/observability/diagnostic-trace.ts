import type { AmdcEnvironment } from "../config/env.js";
import type { PluginName, SanitizedToolError } from "../tools/types.js";
import type { SafeErrorMetadata } from "./safe-error-metadata.js";

interface DiagnosticTraceBase {
  readonly runId: string;
  readonly occurredAt: string;
}

export type DiagnosticTraceEvent =
  | (DiagnosticTraceBase & {
      readonly event: "diagnosis.started";
      readonly environment: AmdcEnvironment;
    })
  | (DiagnosticTraceBase & {
      readonly event: "model.called";
      readonly modelCallIndex: number;
      readonly activePlugin: PluginName | null;
      readonly tools: readonly string[];
    })
  | (DiagnosticTraceBase & {
      readonly event: "model.finished";
      readonly modelCallIndex: number;
      readonly activePlugin: PluginName | null;
      readonly durationMs: number;
    })
  | (DiagnosticTraceBase & {
      readonly event: "model.failed";
      readonly modelCallIndex: number;
      readonly activePlugin: PluginName | null;
      readonly durationMs: number;
      readonly errorName: string;
      readonly errorStage: "model_call";
      readonly errorDetails: SafeErrorMetadata;
    })
  | (DiagnosticTraceBase & {
      readonly event: "plugin.selected";
      readonly plugin: PluginName;
    })
  | (DiagnosticTraceBase & {
      readonly event: "tool.started";
      readonly plugin: PluginName;
      readonly tool: string;
    })
  | (DiagnosticTraceBase & {
      readonly event: "tool.finished";
      readonly plugin: PluginName;
      readonly tool: string;
      readonly durationMs: number;
      readonly outcome: "succeeded" | "failed";
      readonly exitCode?: number;
      readonly errorCode?: SanitizedToolError["code"];
    })
  | (DiagnosticTraceBase & {
      readonly event: "diagnosis.completed";
      readonly durationMs: number;
      readonly selectedTools: readonly string[];
    })
  | (DiagnosticTraceBase & {
      readonly event: "diagnosis.failed";
      readonly durationMs: number;
      readonly errorName: string;
      readonly errorStage:
        | "agent_setup"
        | "agent_invoke"
        | "structured_response_validation"
        | "diagnosis_assembly";
      readonly errorDetails: SafeErrorMetadata;
    });

export interface DiagnosticTraceSink {
  record(event: DiagnosticTraceEvent): Promise<void>;
}

export type DiagnosticTraceWriter = (line: string) => void;

export class ConsoleDiagnosticTraceSink implements DiagnosticTraceSink {
  constructor(
    private readonly writer: DiagnosticTraceWriter = (line) => console.log(line)
  ) {}

  async record(event: DiagnosticTraceEvent): Promise<void> {
    this.writer(
      JSON.stringify({
        component: "amdc.diagnostic_trace",
        ...event
      })
    );
  }
}

export class NoopDiagnosticTraceSink implements DiagnosticTraceSink {
  async record(_event: DiagnosticTraceEvent): Promise<void> {}
}
