import { z } from "zod/v3";
import type { AgentVisibleToolDescriptor, RawToolResult, ToolObservation, ToolRuntimeResult } from "../tools/types.js";

const commentSchema = z.object({
  observation: z.string().max(2000).nullable(),
  hypothesis: z.string().max(2000).nullable(),
  limitation: z.string().max(2000).nullable()
}).strict();

// The model can annotate existing calls, never supply execution records.
export const handoffDraftSchema = z.object({
  completion_reason: z.enum(["investigation_complete", "insufficient_evidence"])
    .describe("Why investigation stopped; complete does not mean healthy or root cause proven."),
  comments: z.array(z.object({
    tool_call_id: z.string().min(1),
    comment: commentSchema.nullable(),
    related_call_ids: z.array(z.string().min(1)).max(100)
      .describe("Other existing call IDs in this diagnosis supporting this annotation, regardless of execution order; not private reasoning.")
  }).strict()).max(100).describe("Optional annotations for actual calls. Use IDs returned by tools; omit calls needing no comment.")
}).strict();

export type HandoffDraft = z.infer<typeof handoffDraftSchema>;
export interface HandoffObservation {
  readonly seq: number;
  readonly tool_call_id: string;
  readonly plugin: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly observed_at: string;
  readonly status: "success" | "error";
  readonly result: RawToolResult | ToolObservation | null;
  readonly error: Extract<ToolRuntimeResult, { ok: false }>["error"] | null;
  readonly comment: z.infer<typeof commentSchema> | null;
  readonly related_call_ids: readonly string[];
}

export interface DiagnosisHandoff {
  readonly diagnosis_id: string;
  readonly request: string;
  readonly completion_reason: HandoffDraft["completion_reason"] | "mock";
  readonly observations: readonly HandoffObservation[];
}

// This boundary must not reintroduce credentials through requests or model comments.
export function assertSafeHandoffData(value: unknown): void {
  const text = JSON.stringify(value);
  const secrets = Object.entries(process.env)
    .filter(([key, value]) => /TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY|SESSION/i.test(key) && value && value.length >= 8)
    .map(([, value]) => value!);
  if (secrets.some(secret => text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1))) ||
      /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(text)) {
    throw new Error("Handoff rejected: sensitive data.");
  }
}

// Per-diagnosis only. Reserve before awaiting so parallel completion cannot reorder IDs.
export class DiagnosisLedger {
  private nextSequence = 0;
  private readonly records: HandoffObservation[] = [];
  constructor(readonly diagnosisId: string) {}

  begin(descriptor: AgentVisibleToolDescriptor, input: Record<string, unknown>) {
    assertSafeHandoffData(input);
    const seq = ++this.nextSequence;
    return {
      seq, tool_call_id: `${this.diagnosisId}:call-${seq}`,
      plugin: descriptor.pluginName, tool: descriptor.name,
      input: structuredClone(input)
    };
  }

  finish(call: ReturnType<DiagnosisLedger["begin"]>, output: ToolRuntimeResult) {
    assertSafeHandoffData(output);
    this.records.push(structuredClone({
      ...call,
      observed_at: output.ok
        ? ("rawResult" in output ? output.rawResult.collectedAt : output.observation.collectedAt)
        : output.error.occurredAt,
      status: output.ok ? "success" : "error",
      result: output.ok ? ("rawResult" in output ? output.rawResult : output.observation) : null,
      error: output.ok ? null : output.error,
      comment: null, related_call_ids: []
    } satisfies HandoffObservation));
  }

  assemble(request: string, candidate: unknown): DiagnosisHandoff {
    const draft = handoffDraftSchema.parse(candidate);
    const byId = new Map(this.records.map(record => [record.tool_call_id, record]));
    const annotations = new Map<string, HandoffDraft["comments"][number]>();
    for (const annotation of draft.comments) {
      const record = byId.get(annotation.tool_call_id);
      if (!record || annotations.has(annotation.tool_call_id)) throw new Error("Invalid handoff call reference.");
      for (const id of annotation.related_call_ids) {
        if (!byId.has(id) || id === record.tool_call_id) throw new Error("Invalid handoff related call reference.");
      }
      if (new Set(annotation.related_call_ids).size !== annotation.related_call_ids.length) {
        throw new Error("Duplicate handoff related call reference.");
      }
      annotations.set(annotation.tool_call_id, annotation);
    }
    const handoff: DiagnosisHandoff = {
      diagnosis_id: this.diagnosisId, request,
      completion_reason: this.records.length ? draft.completion_reason : "insufficient_evidence",
      observations: [...this.records].sort((a, b) => a.seq - b.seq).map(record => {
        const annotation = annotations.get(record.tool_call_id);
        return { ...record, comment: annotation?.comment ?? null, related_call_ids: annotation?.related_call_ids ?? [] };
      })
    };
    assertSafeHandoffData(handoff);
    return structuredClone(handoff);
  }
}
