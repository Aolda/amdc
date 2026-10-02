import { readFileSync } from "node:fs";
import type { DiagnosisHandoff } from "../report/diagnosis-handoff.js";
import type { ReportModelAdapter, ReportModelRequest } from "./report-agent.js";
import { ReportAgentError } from "./errors.js";
import { REPORT_SYSTEM_PROMPT } from "./prompt.js";
import { createReportValidators } from "./validation.js";

export interface MvpObservation {
  seq: number;
  tool_call_id: string;
  tool: string;
  plugin: string;
  observed_at: string;
  status: "success" | "error";
  error_code: string | null;
  execution_summary: string;
  diagnostic_comment: { observation: string | null; hypothesis: string | null; limitation: string | null } | null;
  related_call_ids: string[];
}

export interface MvpReport {
  schema_version: "diagnosis-report/1.0.0";
  diagnosis_id: string;
  created_at: string;
  completion_reason: "investigation_complete" | "insufficient_evidence";
  summary: string;
  observations: MvpObservation[];
  limitations: string[];
  suspected_cause: string | null;
  recommended_next_action: string;
}

const MAX_BYTES = 1024 * 1024;
const MAX_CALLS = 100;
const MAX_REQUEST = 4000;
const MAX_COMMENT = 2000;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DIAG_ID = /^diag-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_NAME = /^[a-z][a-z0-9_-]{0,99}$/i;
const UNSAFE_COMMENT = /https?:\/\/|\b(?:select|insert|update|delete|drop|alter|create)\s+(?:\*|[\w"'`])|\b(?:curl|ssh|sudo|kubectl|docker|mysql|psql|bash|sh|powershell|pwsh)\s+[-\w]|[;&|]\s*(?:curl|ssh|sudo|kubectl|docker|mysql|psql|bash|sh|powershell|pwsh)\b/i;
const ERROR_CODES = new Set(["unknown_tool", "invalid_input", "environment_not_allowed", "tool_timeout", "tool_output_too_large", "malformed_source_response", "source_request_failed", "source_permission_denied", "source_unavailable", "secret_exposure_risk", "tool_call_limit_reached"]);
const DRAFT_SCHEMA = Object.freeze(JSON.parse(readFileSync(
  new URL("../../schemas/report-narrative-draft.schema.json", import.meta.url), "utf8"
)) as Record<string, unknown>);

function invalid(): never { throw new ReportAgentError("invalid_report_generation"); }
function safeScan(text: string, containsSecret: (value: string) => boolean): void {
  let found: boolean;
  try { found = containsSecret(text); } catch { invalid(); }
  if (found) throw new ReportAgentError("secret_exposure_risk");
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key))) invalid();
  return item;
}
function string(value: unknown, max: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u001f\u007f\u0085\u2028\u2029]/u.test(value)) invalid();
  return value;
}
function time(value: unknown): string {
  const text = string(value, 24);
  if (!ISO_TIME.test(text) || !Number.isFinite(Date.parse(text)) || new Date(Date.parse(text)).toISOString() !== text) invalid();
  return text;
}
function name(value: unknown): string {
  const text = string(value, 100);
  if (!SAFE_NAME.test(text)) invalid();
  return text;
}
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) invalid();
  return value as number;
}
function assertJsonTree(value: unknown, containsSecret?: (value: string) => boolean, depth = 0, budget = { nodes: 0, ancestors: new Set<object>() }): void {
  budget.nodes += 1;
  if (depth > 40 || budget.nodes > 65536) invalid();
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") { if (containsSecret) safeScan(value, containsSecret); return; }
  if (typeof value === "number") { if (!Number.isFinite(value)) invalid(); return; }
  if (typeof value !== "object") invalid();
  if (budget.ancestors.has(value)) invalid();
  budget.ancestors.add(value);
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) invalid();
    for (let i = 0; i < value.length; i += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, i);
      if (!descriptor || !("value" in descriptor)) invalid();
      assertJsonTree(descriptor.value, containsSecret, depth + 1, budget);
    }
    budget.ancestors.delete(value);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) invalid();
  if (Object.getOwnPropertySymbols(value).length) invalid();
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor) || !descriptor.enumerable) invalid();
    assertJsonTree(key, containsSecret, depth + 1, budget);
    assertJsonTree(descriptor.value, containsSecret, depth + 1, budget);
  }
  budget.ancestors.delete(value);
}
function json(value: unknown, maximum = MAX_BYTES, containsSecret?: (value: string) => boolean): string {
  try { assertJsonTree(value, containsSecret); }
  catch (error) { if (error instanceof ReportAgentError) throw error; invalid(); }
  let serialized: string | undefined;
  try { serialized = JSON.stringify(value); } catch { invalid(); }
  if (typeof serialized !== "string" || Buffer.byteLength(serialized, "utf8") > maximum) invalid();
  return serialized;
}
function comment(value: unknown): MvpObservation["diagnostic_comment"] {
  if (value === null) return null;
  const source = record(value, ["observation", "hypothesis", "limitation"]);
  const output = {} as NonNullable<MvpObservation["diagnostic_comment"]>;
  for (const key of ["observation", "hypothesis", "limitation"] as const) {
    const field = source[key];
    if (field !== null && (UNSAFE_COMMENT.test(string(field, MAX_COMMENT)) || /\b(?:endpoint|sql|command)\s*[:=]/i.test(field as string))) invalid();
    output[key] = field as string | null;
  }
  return output;
}
function collectStrings(value: unknown, output: Set<string>, depth = 0, budget = { nodes: 0 }): void {
  budget.nodes += 1;
  if (depth > 40 || budget.nodes > 65536) invalid();
  if (typeof value === "string") {
    if (value.length >= 8) output.add(value);
    // A JSON string may itself contain serialized JSON. Keep one traversal budget.
    let parsed: unknown;
    try { parsed = JSON.parse(value); }
    catch (error) { if (!(error instanceof SyntaxError)) invalid(); }
    if (parsed !== undefined) collectStrings(parsed, output, depth + 1, budget);
    // JSON.parse drops duplicate members; curl can append HTTP trailers to JSON.
    // Also retain JSON string values from the original text, without tokenizing prose.
    for (const token of value.matchAll(/"(?:[^"\\]|\\.)*"/gs)) {
      let next = token.index + token[0].length;
      while (/[ \t\r\n]/.test(value.charAt(next)) && next < value.length) next += 1;
      if (value.charAt(next) === ":") continue; // Object key, not a value.
      let decoded: unknown;
      try { decoded = JSON.parse(token[0]); }
      catch (error) { if (error instanceof SyntaxError) continue; invalid(); }
      if (typeof decoded === "string" && decoded.length >= 8 && !output.has(decoded)) {
        collectStrings(decoded, output, depth + 1, budget);
      }
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach(item => collectStrings(item, output, depth + 1, budget)); return; }
  if (value && typeof value === "object") Object.values(value).forEach(item => collectStrings(item, output, depth + 1, budget));
}
function collectRawText(value: string, output: Set<string>): void {
  const budget = { nodes: 0 };
  if (value.length >= 8) output.add(value);
  let body = value.trimStart();
  let blocks = 0;
  // curl --include can prefix a response with proxy/1xx header blocks. Remove only
  // anchored HTTP framing; splitting the entire output would break pretty JSON.
  while (/^HTTP\/\d+(?:\.\d+)? [1-5]\d{2}(?: [^\r\n]*)?\r?\n/.test(body)) {
    const separator = /\r?\n\r?\n/.exec(body);
    if (!separator) break;
    if (++blocks > 40) invalid();
    for (const header of body.slice(0, separator.index).split(/\r?\n/).slice(1)) {
      const colon = header.indexOf(":");
      if (colon > 0) collectStrings(header.slice(colon + 1).trim(), output, 0, budget);
    }
    body = body.slice(separator.index + separator[0].length).trimStart();
  }
  collectStrings(body.trim(), output, 0, budget);
}
function collectRawValues(result: Record<string, unknown>, output: Set<string>): void {
  if (result.transport === "mysql") collectStrings(result.rows, output);
  if (result.transport === "http") {
    collectRawText((result.response as { body: string }).body, output);
  }
  if (result.transport === "local_shell") {
    const execution = result.execution as { stdout: string; stderr: string };
    collectRawText(execution.stdout, output);
    collectRawText(execution.stderr, output);
  }
}
function rejectRawEcho(text: string, rawValues: ReadonlySet<string>): void {
  if ([...rawValues].some(value => text.includes(value))) invalid();
}
function execution(value: unknown, tool: string, plugin: string, observedAt: string): { summary: string; truncated: boolean } {
  const base = value as Record<string, unknown>;
  if (!base || typeof base !== "object" || Array.isArray(base) || base.toolName !== tool || base.pluginName !== plugin || base.collectedAt !== observedAt) invalid();
  name(base.source);
  if (base.transport === "mysql") {
    record(value, ["toolName", "pluginName", "source", "collectedAt", "transport", "appliedFilters", "limit", "rows", "returnedRows", "truncated"]);
    if (!Array.isArray(base.rows) || typeof base.truncated !== "boolean") invalid();
    const count = integer(base.returnedRows, 0, 1000000);
    const limit = integer(base.limit, 1, 1000000);
    if (count !== base.rows.length || count > limit || (base.truncated && count !== limit) || !base.appliedFilters || typeof base.appliedFilters !== "object" || Array.isArray(base.appliedFilters)) invalid();
    return { summary: `MySQL 조회 실행 완료; 반환 행 ${count}건; 결과 잘림: ${base.truncated ? "예" : "아니요"}.`, truncated: base.truncated };
  }
  if (base.transport === "http") {
    record(value, ["toolName", "pluginName", "source", "collectedAt", "transport", "response"]);
    const response = record(base.response, ["statusCode", "contentType", "body"]);
    const status = integer(response.statusCode, 100, 599);
    if (typeof response.body !== "string" || (response.contentType !== null && typeof response.contentType !== "string")) invalid();
    return { summary: `HTTP 조회 실행 완료; 상태 코드 ${status}.`, truncated: false };
  }
  if (base.transport === "local_shell") {
    record(value, ["toolName", "pluginName", "source", "collectedAt", "transport", "execution"]);
    const result = record(base.execution, ["stdout", "stderr", "exitCode"]);
    if (typeof result.stdout !== "string" || typeof result.stderr !== "string") invalid();
    const exit = integer(result.exitCode, -65535, 65535);
    return { summary: `로컬 수집 실행 완료; 종료 코드 ${exit}.`, truncated: false };
  }
  record(value, ["toolName", "pluginName", "source", "status", "summary", "facts", "collectedAt"]);
  if (!["normal", "warning", "critical", "unknown"].includes(base.status as string) || typeof base.summary !== "string" || !Array.isArray(base.facts)) invalid();
  // Producer facts and prose are deliberately omitted; status is a source assessment, not a report conclusion.
  return { summary: `도구 수집 실행 완료; 원천 상태 ${base.status}.`, truncated: false };
}
function parseHandoff(value: unknown, containsSecret: (value: string) => boolean): { handoff: DiagnosisHandoff & { completion_reason: MvpReport["completion_reason"] }; projected: MvpObservation[]; truncated: boolean; rawValues: ReadonlySet<string> } {
  safeScan(json(value, MAX_BYTES, containsSecret), containsSecret);
  const source = record(value, ["diagnosis_id", "request", "completion_reason", "observations"]);
  const diagnosisId = string(source.diagnosis_id, 41);
  if (!DIAG_ID.test(diagnosisId)) invalid();
  string(source.request, MAX_REQUEST);
  if (source.completion_reason !== "investigation_complete" && source.completion_reason !== "insufficient_evidence") invalid();
  if (!Array.isArray(source.observations) || source.observations.length > MAX_CALLS) invalid();
  const ids = source.observations.map((_, index) => `${diagnosisId}:call-${index + 1}`);
  let truncated = false;
  const rawValues = new Set<string>();
  const projected = source.observations.map((raw, index): MvpObservation => {
    const call = record(raw, ["seq", "tool_call_id", "plugin", "tool", "input", "observed_at", "status", "result", "error", "comment", "related_call_ids"]);
    const seq = integer(call.seq, 1, MAX_CALLS);
    if (seq !== index + 1 || call.tool_call_id !== ids[index]) invalid();
    const plugin = name(call.plugin);
    const tool = name(call.tool);
    const observedAt = time(call.observed_at);
    if (!call.input || typeof call.input !== "object" || Array.isArray(call.input)) invalid();
    const diagnosticComment = comment(call.comment);
    if (!Array.isArray(call.related_call_ids) || call.related_call_ids.length > MAX_CALLS || new Set(call.related_call_ids).size !== call.related_call_ids.length || call.related_call_ids.some(id => typeof id !== "string" || id === call.tool_call_id || !ids.includes(id))) invalid();
    if (call.status === "success") {
      if (call.error !== null || call.result === null) invalid();
      const executionResult = execution(call.result, tool, plugin, observedAt);
      collectRawValues(call.result as Record<string, unknown>, rawValues);
      truncated ||= executionResult.truncated;
      return { seq, tool_call_id: ids[index], plugin, tool, observed_at: observedAt, status: "success", error_code: null, execution_summary: executionResult.summary, diagnostic_comment: diagnosticComment, related_call_ids: [...call.related_call_ids] as string[] };
    }
    if (call.status !== "error" || call.result !== null) invalid();
    const error = record(call.error, ["toolName", "pluginName", "code", "message", "occurredAt"]);
    if (error.toolName !== tool || error.pluginName !== plugin || error.occurredAt !== observedAt || !ERROR_CODES.has(error.code as string) || typeof error.message !== "string") invalid();
    return { seq, tool_call_id: ids[index], plugin, tool, observed_at: observedAt, status: "error", error_code: error.code as string, execution_summary: `도구 조회 실패; 오류 코드 ${error.code}.`, diagnostic_comment: diagnosticComment, related_call_ids: [...call.related_call_ids] as string[] };
  });
  for (const call of projected) {
    if (call.diagnostic_comment) Object.values(call.diagnostic_comment).forEach(value => { if (value !== null) rejectRawEcho(value, rawValues); });
  }
  return { handoff: source as unknown as DiagnosisHandoff & { completion_reason: MvpReport["completion_reason"] }, projected, truncated, rawValues };
}

export function validateMvpReport(value: unknown, containsSecret: (s: string) => boolean): MvpReport {
  safeScan(json(value, 256 * 1024, containsSecret), containsSecret);
  const report = record(value, ["schema_version", "diagnosis_id", "created_at", "completion_reason", "summary", "observations", "limitations", "suspected_cause", "recommended_next_action"]);
  if (report.schema_version !== "diagnosis-report/1.0.0" || !DIAG_ID.test(string(report.diagnosis_id, 41))) invalid();
  time(report.created_at);
  if (!["investigation_complete", "insufficient_evidence"].includes(report.completion_reason as string)) invalid();
  if (UNSAFE_COMMENT.test(string(report.summary, 1000))) invalid();
  if (UNSAFE_COMMENT.test(string(report.recommended_next_action, 1000))) invalid();
  if (!Array.isArray(report.limitations) || report.limitations.length > MAX_CALLS + 3) invalid();
  report.limitations.forEach(item => { if (UNSAFE_COMMENT.test(string(item, 1000))) invalid(); });
  if (report.suspected_cause !== null) {
    // The draft schema counts Unicode code points; each uses at most two UTF-16 units.
    const cause = string(report.suspected_cause, 600);
    if ([...cause].length > 300 || UNSAFE_COMMENT.test(cause)) invalid();
  }
  if (!Array.isArray(report.observations) || report.observations.length > MAX_CALLS) invalid();
  const ids = report.observations.map((_, i) => `${report.diagnosis_id}:call-${i + 1}`);
  report.observations.forEach((raw, index) => {
    const call = record(raw, ["seq", "tool_call_id", "tool", "plugin", "observed_at", "status", "error_code", "execution_summary", "diagnostic_comment", "related_call_ids"]);
    if (call.seq !== index + 1 || call.tool_call_id !== ids[index]) invalid();
    name(call.tool); name(call.plugin); time(call.observed_at);
    if (UNSAFE_COMMENT.test(string(call.execution_summary, 300))) invalid();
    if (call.status === "success" ? call.error_code !== null : call.status !== "error" || !ERROR_CODES.has(call.error_code as string)) invalid();
    comment(call.diagnostic_comment);
    if (!Array.isArray(call.related_call_ids) || new Set(call.related_call_ids).size !== call.related_call_ids.length || call.related_call_ids.some(id => typeof id !== "string" || id === call.tool_call_id || !ids.includes(id))) invalid();
  });
  return value as MvpReport;
}

export async function createMvpReport(handoff: unknown, deps: { model: ReportModelAdapter; containsSecret: (s: string) => boolean; signal?: AbortSignal }): Promise<MvpReport> {
  const parsed = parseHandoff(handoff, deps.containsSecret);
  const successes = parsed.projected.filter(call => call.status === "success").length;
  const failures = parsed.projected.length - successes;
  const limitations = [
    ...(parsed.projected.length === 0 ? ["도구 호출 기록이 없어 실행 근거를 확인할 수 없습니다."] : []),
    ...(failures ? [`도구 호출 ${failures}건이 실패해 해당 결과를 확인할 수 없습니다.`] : []),
    ...(parsed.truncated ? ["일부 결과가 잘려 전체 원본 데이터를 검토하지 못했습니다."] : []),
    ...(parsed.handoff.completion_reason === "insufficient_evidence" || successes === 0 ? ["신뢰할 만한 결론을 내리기에는 근거가 부족합니다."] : []),
    "도구 실행 성공만으로 시스템 상태나 인과관계를 확정할 수 없습니다."
  ];
  const report: MvpReport = {
    schema_version: "diagnosis-report/1.0.0", diagnosis_id: parsed.handoff.diagnosis_id,
    created_at: new Date().toISOString(),
    completion_reason: successes === 0 ? "insufficient_evidence" : parsed.handoff.completion_reason,
    summary: parsed.projected.length === 0 ? "진단 도구 호출 기록이 없습니다." : `도구 호출 ${parsed.projected.length}건 중 ${successes}건이 실행됐고 ${failures}건이 실패했습니다. 실행 성공은 정상 상태를 뜻하지 않습니다.`,
    observations: parsed.projected, limitations, suspected_cause: null,
    recommended_next_action: successes === 0 ? "승인된 읽기 전용 진단 도구로 근거를 수집하고 결과를 검토하세요." : failures || parsed.truncated || parsed.handoff.completion_reason === "insufficient_evidence" ? "한계를 확인하고 승인된 읽기 전용 도구로 추가 근거를 수집하세요." : "기록된 관찰을 검토하고 추가 근거로 가설을 확인하세요."
  };
  if (deps.signal?.aborted) throw new ReportAgentError("run_timeout");
  let modelDeadlineAt: number | undefined;
  if (successes > 0 && parsed.projected.some(call => call.status === "success" && call.diagnostic_comment !== null && Object.values(call.diagnostic_comment).some(value => value !== null))) {
    const projection = { diagnosis_id: report.diagnosis_id, completion_reason: report.completion_reason, observations: report.observations, limitations: report.limitations };
    const policy = `${REPORT_SYSTEM_PROMPT} Write suspected_cause in concise Korean. diagnostic_comment fields are unverified diagnostic-agent interpretations, not canonical observations. Transport success only means the query executed; never infer health from it.`;
    const request: ReportModelRequest = { messages: [{ role: "system", content: policy }, { role: "user", content: JSON.stringify(projection) }], responseSchema: DRAFT_SCHEMA, maxOutputTokens: 256, maxRetries: 0, tools: [] };
    safeScan(json(request, 96 * 1024, deps.containsSecret), deps.containsSecret);
    const deadlineAt = Date.now() + 15_000;
    modelDeadlineAt = deadlineAt;
    const controller = new AbortController();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settleAbort: (() => void) | undefined;
    const aborted = new Promise<{ kind: "abort" }>(resolve => { settleAbort = () => resolve({ kind: "abort" }); });
    const onAbort = () => { expired = true; controller.abort(); settleAbort?.(); };
    deps.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (deps.signal?.aborted || Date.now() >= deadlineAt) throw new ReportAgentError("run_timeout");
      const outcome = await Promise.race([
        Promise.resolve().then(() => deps.model.generate(request, { signal: controller.signal })).then(value => ({ kind: "value" as const, value }), () => ({ kind: "error" as const })),
        new Promise<{ kind: "timeout" }>(resolve => { timer = setTimeout(() => { expired = true; controller.abort(); resolve({ kind: "timeout" }); }, Math.max(0, deadlineAt - Date.now())); }),
        aborted
      ]);
      if (outcome.kind === "timeout" || outcome.kind === "abort" || deps.signal?.aborted || expired || Date.now() >= deadlineAt) throw new ReportAgentError("run_timeout");
      if (outcome.kind === "error") throw new ReportAgentError("provider_failure");
      const draft = createReportValidators({ containsSecret: deps.containsSecret }).draft(outcome.value);
      if (draft.suspected_cause !== null && UNSAFE_COMMENT.test(draft.suspected_cause)) invalid();
      if (draft.suspected_cause !== null) rejectRawEcho(draft.suspected_cause, parsed.rawValues);
      safeScan(json(draft, MAX_BYTES, deps.containsSecret), deps.containsSecret);
      if (deps.signal?.aborted || Date.now() >= deadlineAt) throw new ReportAgentError("run_timeout");
      report.suspected_cause = draft.suspected_cause;
    } finally {
      if (timer) clearTimeout(timer);
      deps.signal?.removeEventListener("abort", onAbort);
      settleAbort = undefined;
      controller.abort();
    }
  }
  const validated = validateMvpReport(report, deps.containsSecret);
  if (deps.signal?.aborted || (modelDeadlineAt !== undefined && Date.now() >= modelDeadlineAt)) throw new ReportAgentError("run_timeout");
  return validated;
}
