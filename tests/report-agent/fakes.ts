import type { ReportModelAdapter, ReportModelRequest, ReportRunContext } from "../../src/report-agent/report-agent.js";
import { REPORT_PROMPT_VERSION } from "../../src/report-agent/prompt.js";

export const REFERENCE_TIME = "2026-09-22T00:00:00.000Z";

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export class FakeClock {
  private current = 0;
  private nextId = 0;
  private readonly timers = new Map<number, { readonly dueAt: number; readonly callback: () => void }>();

  now(): number {
    return this.current;
  }

  get pendingTimers(): number {
    return this.timers.size;
  }

  schedule(callback: () => void, delayMs: number): () => void {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.current + delayMs, callback });
    return () => this.timers.delete(id);
  }

  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.current = due[1].dueAt;
      due[1].callback();
    }
    this.current = target;
  }

  setNowWithoutRunningTimers(value: number): void {
    this.current = value;
  }

  advanceWithoutFiring(ms: number): void {
    this.current += ms;
  }
}

export class FakeModel implements ReportModelAdapter {
  readonly calls: { readonly request: ReportModelRequest; readonly signal: AbortSignal }[] = [];
  result: Promise<unknown> = Promise.resolve({ suspected_cause: "Backend health degraded" });
  thrown: unknown | undefined;

  generate(request: ReportModelRequest, options: { readonly signal: AbortSignal }): Promise<unknown> {
    this.calls.push({ request, signal: options.signal });
    if (this.thrown !== undefined) throw this.thrown;
    return this.result;
  }
}

function ulid(index: number): string {
  return `0${index.toString(10).padStart(25, "0")}`;
}

export function makeInput(index = 1): Record<string, unknown> {
  const runId = `run_${ulid(index)}`;
  const evidenceId = `ev_${ulid(index)}`;
  const toolCallId = `tc_${ulid(index)}`;
  return {
    contract_version: "report-agent-input/1.0.0",
    report_schema_version: "1.1.0",
    run: {
      run_id: runId,
      scenario: "backend_5xx_increase",
      diagnostic_reference_time: REFERENCE_TIME,
    },
    diagnosis: {
      contract_version: "diagnosis-result/1.0.0",
      inferred_domains: [{ domain: "backend", reason: "health evidence" }],
      preliminary_findings: [{
        finding: "Backend health is degraded.",
        basis: [evidenceId],
        level: "warning",
      }],
      suspected_causes: [{
        cause: "A backend dependency may be degraded.",
        basis: [evidenceId],
        confidence: "medium",
      }],
      recommended_checks: ["Confirm backend dependencies manually."],
      incomplete_reasons: [],
    },
    evidence_schema_version: "1.1.0",
    tool_error_schema_version: "1.0.0",
    evidence: [{
      evidence_id: evidenceId,
      run_id: runId,
      tool_call_id: toolCallId,
      tool_name: "backend_health",
      source: "amdb_backend",
      source_contract_version: "backend_health/v1",
      time_range: { start: REFERENCE_TIME, end: REFERENCE_TIME },
      category: "health",
      assessment: "positive",
      severity: "warning",
      summary: "Backend health is degraded.",
      payload: {
        service_status: "degraded",
        dependencies: [{ name: "database", status: "degraded" }],
        checked_at: REFERENCE_TIME,
        source_assessment: "degraded",
      },
      truncated: false,
      redaction_status: "passed",
      collected_at: REFERENCE_TIME,
    }],
    tool_errors: [],
  };
}

export function makeContext(
  input: Record<string, unknown>,
  overrides: Partial<ReportRunContext> = {},
): ReportRunContext {
  const run = input.run as { run_id: string; diagnostic_reference_time: string };
  const evidence = input.evidence as { evidence_id: string; tool_call_id: string }[];
  return {
    runId: run.run_id,
    diagnosticReferenceTime: run.diagnostic_reference_time,
    artifacts: evidence.map((item) => ({
      toolCallId: item.tool_call_id,
      evidenceId: item.evidence_id,
    })),
    resultStatus: "problem_detected",
    reportPromptVersion: REPORT_PROMPT_VERSION,
    deadlineAt: 60_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}
