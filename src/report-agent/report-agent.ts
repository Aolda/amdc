import { readFileSync } from "node:fs";
import type { ReportAgentOutputV1 } from "./contracts.js";
import { ReportAgentError } from "./errors.js";
import { REPORT_LIMITS, REPORT_PROMPT_VERSION, REPORT_SYSTEM_PROMPT } from "./prompt.js";
import { createReportValidators, type ReportInputContext } from "./validation.js";

export interface ReportModelRequest {
  readonly messages: readonly { readonly role: "system" | "user"; readonly content: string }[];
  readonly responseSchema: Readonly<Record<string, unknown>>;
  readonly maxOutputTokens: 256;
  readonly maxRetries: 0;
  readonly tools: readonly never[];
}

/** Trusted adapter: one provider call, native structured output, no retries or tools.
 * It must honor signal and maxOutputTokens, remove its listeners on settlement,
 * and return only the parsed draft. This module does not configure a live provider.
 */
export interface ReportModelAdapter {
  generate(request: ReportModelRequest, options: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface ReportAgentPort {
  generate(input: unknown): Promise<ReportAgentOutputV1>;
}

export interface ReportClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}

export interface ReportRunContext extends ReportInputContext {
  /** Already computed by the AMDC interpreter; this port never diagnoses status. */
  readonly resultStatus: "problem_detected" | "no_problem_detected" | "insufficient_tools" | "needs_permission";
  /** Persisted binding, committed before constructing a problem_detected port. */
  readonly reportPromptVersion: string | null;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
}

export interface ReportAgentDependencies {
  readonly model: ReportModelAdapter;
  /** Inject the AMDC scanner with loaded secrets; never expose those values to the adapter. */
  readonly containsSecret: (value: string) => boolean;
  readonly clock?: ReportClock;
}

const realClock: ReportClock = {
  now: () => Date.now(),
  schedule(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

const draftSchema = freezeTree(JSON.parse(readFileSync(
  new URL("../../schemas/report-narrative-draft.schema.json", import.meta.url), "utf8",
)) as Record<string, unknown>);

type ModelCompletion = { readonly ok: true; readonly value: unknown } | { readonly ok: false };
interface CompletionCell {
  settle?: (completion: ModelCompletion) => void;
}

// The source Promise may never settle. Its handlers retain only this empty cell
// after cleanup, never the Run, input, scanner, timer or parent AbortSignal.
function observeModelCompletion(invocation: Promise<unknown>, cell: CompletionCell): void {
  Promise.resolve(invocation).then(
    (value) => cell.settle?.({ ok: true, value }),
    () => cell.settle?.({ ok: false }),
  );
}
/** One port per Run, owned by its caller; no global Run cache or cross-Run history.
 * Reusing this port, even after failure, is rejected. Creating another port for the
 * same Run is the future coordinator's responsibility, not an idempotency store.
 */
export function createReportAgentPort(
  dependencies: ReportAgentDependencies,
  context: ReportRunContext,
): ReportAgentPort {
  const clock = dependencies.clock ?? realClock;
  const validators = createReportValidators({ containsSecret: dependencies.containsSecret });
  const invoke = dependencies.model.generate.bind(dependencies.model);
  // Snapshot server-owned metadata; caller mutation must not change the binding.
  let pendingContext: ReportRunContext | undefined = {
    runId: context.runId,
    diagnosticReferenceTime: context.diagnosticReferenceTime,
    artifacts: context.artifacts.map((artifact) => ({ ...artifact })),
    resultStatus: context.resultStatus,
    reportPromptVersion: context.reportPromptVersion,
    deadlineAt: context.deadlineAt,
    signal: context.signal,
  };

  return {
    async generate(value) {
      const run = pendingContext;
      pendingContext = undefined;
      if (!run) throw new ReportAgentError("agent_budget_exhausted");
      if (!Number.isFinite(run.deadlineAt)
        || !["problem_detected", "no_problem_detected", "insufficient_tools", "needs_permission"].includes(run.resultStatus)
        || (run.resultStatus === "problem_detected"
          ? run.reportPromptVersion !== REPORT_PROMPT_VERSION
          : run.reportPromptVersion !== null)) {
        throw new ReportAgentError("invalid_report_generation");
      }
      const input = validators.input(value, run);
      if (run.signal.aborted || clock.now() >= run.deadlineAt) {
        throw new ReportAgentError("run_timeout");
      }
      if (run.resultStatus !== "problem_detected") {
        const output = validators.output({
          contract_version: "report-agent-output/1.0.0",
          report_schema_version: "1.1.0",
          run_id: run.runId,
          suspected_cause: null,
        }, run.runId);
        if (run.signal.aborted || clock.now() >= run.deadlineAt) {
          throw new ReportAgentError("run_timeout");
        }
        return output;
      }

      const request: ReportModelRequest = freezeTree({
        messages: [
          { role: "system", content: REPORT_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(input) },
        ],
        responseSchema: draftSchema,
        maxOutputTokens: REPORT_LIMITS.maxOutputTokens,
        maxRetries: REPORT_LIMITS.automaticRetries,
        tools: [],
      });
      // Scan precisely the bytes exposed to the adapter, including the policy.
      let containsSecret: boolean;
      try {
        containsSecret = dependencies.containsSecret(JSON.stringify(request));
      } catch {
        throw new ReportAgentError("invalid_report_generation");
      }
      if (containsSecret) {
        throw new ReportAgentError("secret_exposure_risk");
      }
      const startedAt = clock.now();
      if (run.signal.aborted || startedAt >= run.deadlineAt) {
        throw new ReportAgentError("run_timeout");
      }
      const expiresAt = Math.min(run.deadlineAt, startedAt + REPORT_LIMITS.timeoutMs);
      const timeoutCode = run.deadlineAt <= startedAt + REPORT_LIMITS.timeoutMs ? "run_timeout" : "provider_failure";
      const controller = new AbortController();
      const raw = await new Promise<unknown>((resolve, reject) => {
        let settled = false;
        const completion: CompletionCell = {};
        let cancelTimer: (() => void) | undefined;
        const cleanup = () => {
          completion.settle = undefined;
          cancelTimer?.();
          run.signal.removeEventListener("abort", onAbort);
        };
        const fail = (code: "run_timeout" | "provider_failure") => {
          if (settled) return;
          settled = true;
          cleanup();
          // Never forward the parent's possibly sensitive abort reason.
          controller.abort(new ReportAgentError(code));
          reject(new ReportAgentError(code));
        };
        const onAbort = () => fail("run_timeout");
        run.signal.addEventListener("abort", onAbort, { once: true });
        cancelTimer = clock.schedule(() => fail(timeoutCode), expiresAt - startedAt);
        if (run.signal.aborted) {
          onAbort();
          return;
        }
        // Resolve/throw handling is attached immediately; late rejection is consumed.
        let invocation: Promise<unknown>;
        try {
          invocation = invoke(request, { signal: controller.signal });
        } catch {
          fail(run.signal.aborted ? "run_timeout" : clock.now() >= expiresAt ? timeoutCode : "provider_failure");
          return;
        }
        completion.settle = (result) => {
          if (settled) return;
          if (run.signal.aborted || clock.now() >= expiresAt) {
            fail(run.signal.aborted ? "run_timeout" : timeoutCode);
            return;
          }
          if (!result.ok) {
            fail("provider_failure");
            return;
          }
          settled = true;
          cleanup();
          resolve(result.value);
        };
        // An abort can occur synchronously inside the trusted adapter invocation.
        if (settled) completion.settle = undefined;
        observeModelCompletion(invocation, completion);
      });
      const draft = validators.draft(raw);
      const output = validators.output({
        contract_version: "report-agent-output/1.0.0",
        report_schema_version: "1.1.0",
        run_id: run.runId,
        suspected_cause: draft.suspected_cause,
      }, run.runId);
      // Validation cannot grant extra time after a delayed provider completion.
      if (run.signal.aborted || clock.now() >= expiresAt) {
        throw new ReportAgentError(run.signal.aborted ? "run_timeout" : timeoutCode);
      }
      return output;
    },
  };
}
