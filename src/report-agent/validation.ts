import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Evidence, ReportAgentInputV1, ReportAgentOutputV1, ReportNarrativeDraftV1 } from "./contracts.js";
import { ReportAgentError } from "./errors.js";

/**
 * TRUSTED server context, scoped by the caller to runId. Artifacts must already
 * be validated and committed; this is their complete canonical call-order ledger.
 * IDs establish membership/order, not equality with stored payloads. The caller
 * must load those validated payloads from persistence, never accept this ledger
 * or producer assessment claims from the model/request. This isolated consumer
 * does not implement storage or the producer's evidence interpretation rules.
 */
export interface ReportInputContext {
  readonly runId: string;
  readonly diagnosticReferenceTime: string;
  readonly artifacts: readonly {
    readonly toolCallId: string;
    readonly evidenceId?: string;
  }[];
}

const MAX_INPUT_BYTES = 96 * 1024;
const MAX_EVIDENCE_BYTES = 16 * 1024;
const MAX_EVIDENCE_ARRAY_BYTES = 64 * 1024;
const MAX_DIAGNOSIS_BYTES = 16 * 1024;
const MAX_ARTIFACTS = 8;
const CONTROLS = /[\u0000-\u001f\u007f\u0085\u2028\u2029]/;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function invalid(): never {
  throw new ReportAgentError("invalid_report_generation");
}

function timestamp(value: string): number {
  if (!TIMESTAMP.test(value)) invalid();
  const millis = Date.parse(value);
  if (!Number.isFinite(millis) || new Date(millis).toISOString() !== value) invalid();
  return millis;
}

// Compiled once. Per-port validators only bind an injected secret detector.
const ajv = new Ajv2020({ allErrors: false, strict: false, validateFormats: true });
ajv.addFormat("date-time", {
  type: "string",
  validate(value: string): boolean {
    try { timestamp(value); return true; } catch { return false; }
  }
});
function schema(file: string): object {
  return JSON.parse(readFileSync(new URL(`../../schemas/${file}`, import.meta.url), "utf8")) as object;
}
ajv.addSchema(schema("evidence.schema.json"));
ajv.addSchema(schema("tool-error.schema.json"));
const draftSchema = ajv.compile<ReportNarrativeDraftV1>(schema("report-narrative-draft.schema.json"));
const inputSchema = ajv.compile<ReportAgentInputV1>(schema("report-agent-input.schema.json"));
const outputSchema = ajv.compile<ReportAgentOutputV1>(schema("report-agent-output.schema.json"));

function isText(path: string): boolean {
  return path === "/suspected_cause" ||
    /^\/diagnosis\/inferred_domains\/\d+\/(domain|reason)$/.test(path) ||
    /^\/diagnosis\/preliminary_findings\/\d+\/finding$/.test(path) ||
    /^\/diagnosis\/suspected_causes\/\d+\/cause$/.test(path) ||
    /^\/diagnosis\/(recommended_checks|incomplete_reasons)\/\d+$/.test(path) ||
    /^\/evidence\/\d+\/summary$/.test(path) ||
    /^\/evidence\/\d+\/payload\/patterns\/\d+\/pattern$/.test(path) ||
    /^\/evidence\/\d+\/payload\/dependencies\/\d+\/name$/.test(path);
}

/**
 * JSON.stringify has the same UTF-8 size as RFC 8785 for this I-JSON subset:
 * finite safe numbers, valid Unicode, plain JSON values, no toJSON/accessors.
 * JCS key sorting changes order but not byte length. We do not claim to return
 * a canonical representation or hash; callers only need its exact byte count.
 */
function assertBytes(value: unknown, maximum: number): string {
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maximum) invalid();
  return serialized;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function checkEvidenceTime(evidence: Evidence): void {
  const start = timestamp(evidence.time_range.start);
  const end = timestamp(evidence.time_range.end);
  const collected = timestamp(evidence.collected_at);
  if (start > end || end > collected) invalid();
  if (evidence.tool_name === "backend_5xx_rate") {
    const baselineStart = timestamp(evidence.payload.baseline_range.start);
    const baselineEnd = timestamp(evidence.payload.baseline_range.end);
    if (baselineStart > baselineEnd || baselineEnd !== start ||
        baselineEnd - baselineStart !== end - start) invalid();
  } else if (evidence.tool_name === "backend_error_log_patterns") {
    const patterns = new Set<string>();
    for (const pattern of evidence.payload.patterns) {
      const first = timestamp(pattern.first_seen);
      const last = timestamp(pattern.last_seen);
      if (first > last || first < start || last > end || patterns.has(pattern.pattern)) invalid();
      patterns.add(pattern.pattern);
    }
  } else {
    const checked = timestamp(evidence.payload.checked_at);
    if (start !== checked || end !== checked) invalid();
    const names = evidence.payload.dependencies.map((dependency) => dependency.name);
    if (new Set(names).size !== names.length) invalid();
  }
}

function checkContext(input: ReportAgentInputV1, context: ReportInputContext): void {
  if (input.run.run_id !== context.runId ||
      input.run.diagnostic_reference_time !== context.diagnosticReferenceTime) invalid();
  const referenceTime = timestamp(context.diagnosticReferenceTime);
  const count = input.evidence.length + input.tool_errors.length;
  if (count < 1 || count > MAX_ARTIFACTS || !Array.isArray(context.artifacts) ||
      context.artifacts.length !== count) invalid();
  const ledger = new Map<string, { index: number; evidenceId?: string }>();
  const ledgerEvidence = new Set<string>();
  for (const [index, artifact] of context.artifacts.entries()) {
    if (ledger.has(artifact.toolCallId)) invalid();
    if (artifact.evidenceId !== undefined) {
      if (ledgerEvidence.has(artifact.evidenceId)) invalid();
      ledgerEvidence.add(artifact.evidenceId);
    }
    ledger.set(artifact.toolCallId, { index, evidenceId: artifact.evidenceId });
  }
  const usedCalls = new Set<string>();
  const references = new Set<string>();
  const times = new Map<number, number>();
  let previousIndex = -1;
  for (const evidence of input.evidence) {
    const entry = ledger.get(evidence.tool_call_id);
    if (!entry || entry.evidenceId !== evidence.evidence_id ||
        entry.index <= previousIndex || usedCalls.has(evidence.tool_call_id) ||
        references.has(evidence.evidence_id) || evidence.run_id !== context.runId) invalid();
    previousIndex = entry.index;
    usedCalls.add(evidence.tool_call_id);
    references.add(evidence.evidence_id);
    times.set(entry.index, timestamp(evidence.collected_at));
    assertBytes(evidence, MAX_EVIDENCE_BYTES);
    checkEvidenceTime(evidence);
  }
  previousIndex = -1;
  for (const error of input.tool_errors) {
    if (error.code === "secret_exposure_risk") throw new ReportAgentError("secret_exposure_risk");
    const entry = ledger.get(error.tool_call_id);
    if (!entry || entry.evidenceId !== undefined || entry.index <= previousIndex ||
        usedCalls.has(error.tool_call_id)) invalid();
    previousIndex = entry.index;
    usedCalls.add(error.tool_call_id);
    references.add(`tool:${error.tool_call_id}/${error.code}`);
    times.set(entry.index, timestamp(error.occurred_at));
  }
  let previousTime = referenceTime;
  for (let index = 0; index < count; index += 1) {
    const time = times.get(index);
    if (time === undefined || time < previousTime) invalid();
    previousTime = time;
  }
  for (const item of [...input.diagnosis.preliminary_findings, ...input.diagnosis.suspected_causes]) {
    for (const reference of item.basis) if (!references.has(reference)) invalid();
  }
  assertBytes(input.diagnosis, MAX_DIAGNOSIS_BYTES);
  assertBytes(input.evidence, MAX_EVIDENCE_ARRAY_BYTES);
}

export function createReportValidators(options: {
  readonly containsSecret: (value: string) => boolean;
}) {
  function scan(value: string): void {
    if (options.containsSecret(value)) throw new ReportAgentError("secret_exposure_risk");
  }

  function copy(value: unknown): Json {
    let nodes = 0;
    let rawBytes = 0;
    const ancestors = new Set<object>();
    function checkString(text: string): void {
      // Bound work before regex, Unicode normalization, copying, or serialization.
      if (text.length > MAX_INPUT_BYTES) invalid();
      rawBytes += Buffer.byteLength(text, "utf8");
      if (rawBytes > MAX_INPUT_BYTES) invalid();
      scan(text);
      // Check before trim: a trailing newline must never become an accepted line.
      if (CONTROLS.test(text) || UNPAIRED_SURROGATE.test(text)) invalid();
    }
    function visit(current: unknown, path: string, depth: number): Json {
      nodes += 1;
      if (nodes > 8192 || depth > 32) invalid();
      if (current === null || typeof current === "boolean") return current;
      if (typeof current === "number") {
        if (!Number.isFinite(current) || (Number.isInteger(current) && !Number.isSafeInteger(current))) invalid();
        return current;
      }
      if (typeof current === "string") {
        checkString(current);
        const normalized = isText(path) ? current.normalize("NFC").trim() : current;
        scan(normalized);
        return normalized;
      }
      if (typeof current !== "object" || ancestors.has(current)) invalid();
      const array = Array.isArray(current);
      const prototype = Object.getPrototypeOf(current);
      if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
      const keys = Reflect.ownKeys(current);
      if (keys.length > 8192) invalid();
      ancestors.add(current);
      if (array) {
        const length = Object.getOwnPropertyDescriptor(current, "length")?.value as unknown;
        if (typeof length !== "number" || length > 8192 || keys.length !== length + 1) invalid();
        const result: Json[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(index));
          if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid();
          result.push(visit(descriptor.value, `${path}/${index}`, depth + 1));
        }
        ancestors.delete(current);
        return result;
      }
      const result: { [key: string]: Json } = {};
      for (const key of keys) {
        if (typeof key !== "string") invalid();
        checkString(key);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid();
        Object.defineProperty(result, key, {
          value: visit(descriptor.value, `${path}/${key}`, depth + 1),
          enumerable: true, writable: true, configurable: true
        });
      }
      ancestors.delete(current);
      return result;
    }
    const result = visit(value, "", 0);
    // Includes credential key/value pairs and unknown fields before schema rejection.
    scan(assertBytes(result, MAX_INPUT_BYTES));
    return result;
  }

  function protect<T>(operation: () => T): T {
    try { return operation(); } catch (error) {
      // Never reflect Ajv errors, getters, detector failures, values, or causes.
      if (error instanceof ReportAgentError) throw new ReportAgentError(error.code);
      return invalid();
    }
  }

  return {
    input(value: unknown, context: ReportInputContext): ReportAgentInputV1 {
      return protect(() => {
        const result: unknown = copy(value);
        if (!inputSchema(result)) invalid();
        checkContext(result, context);
        return freeze(result);
      });
    },
    draft(value: unknown): ReportNarrativeDraftV1 {
      return protect(() => {
        const result: unknown = copy(value);
        if (!draftSchema(result)) invalid();
        return freeze(result);
      });
    },
    output(value: unknown, runId: string): ReportAgentOutputV1 {
      return protect(() => {
        const result: unknown = copy(value);
        if (!outputSchema(result) || result.run_id !== runId) invalid();
        return freeze(result);
      });
    }
  };
}
