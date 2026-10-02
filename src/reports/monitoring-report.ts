import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { Evidence, SanitizedToolError } from "../report-agent/contracts.js";
import { ReportAgentError } from "../report-agent/errors.js";
import { createReportValidators, type ReportInputContext } from "../report-agent/validation.js";
import { resolveReportStatus, type ReportStatus } from "./outcome-resolver.js";

export interface MonitoringReportV1 {
  readonly status: ReportStatus;
  readonly summary: string;
  readonly detected_problem: string | null;
  readonly observations: readonly string[];
  readonly suspected_cause: string | null;
  readonly recommended_next_action: string;
  readonly needs_additional_permission: boolean;
}

export interface ReportAssemblySource {
  readonly input: unknown;
  readonly output: unknown;
  /** The pre-model interpreter result. It must equal the result recalculated from saved artifacts. */
  readonly resultStatus: ReportStatus;
  /** Server-owned ledger of already validated, committed artifacts in dispatch order. */
  readonly context: ReportInputContext;
}

const MESSAGES = {
  unknown_tool: "등록되지 않은 도구 요청을 차단했다.",
  invalid_input: "도구 입력이 허용 스키마를 통과하지 못했다.",
  environment_not_allowed: "Run 환경에서 이 도구 실행을 허용하지 않았다.",
  budget_exhausted: "진단 도구 호출 예산이 소진됐다.",
  tool_timeout: "도구 호출이 제한 시간 안에 끝나지 않았다.",
  tool_output_too_large: "도구 응답이 허용 크기를 초과해 폐기됐다.",
  malformed_source_response: "원천 응답 형식이 계약과 일치하지 않았다.",
  source_unavailable: "읽기 전용 원천을 사용할 수 없었다.",
  source_permission_denied: "읽기 전용 원천 조회 권한이 부족했다.",
  evidence_budget_exhausted: "증거 저장 예산을 초과해 새 항목을 제외했다.",
  redaction_failed: "안전한 정제를 보장할 수 없어 응답을 폐기했다.",
} as const satisfies Record<Exclude<SanitizedToolError["code"], "secret_exposure_risk">, string>;

const STATUS_TEXT: Record<ReportStatus, {
  readonly summary: string;
  readonly action: string;
}> = {
  problem_detected: {
    summary: "저장된 Evidence에서 문제 신호가 확인되었다.",
    action: "positive Evidence와 관련 dependency 상태를 수동 확인하고 담당자에게 에스컬레이션한다.",
  },
  no_problem_detected: {
    summary: "세 required check에서 문제 신호가 확인되지 않았다.",
    action: "기존 모니터링을 계속하고 새 증상이 생기면 별도 Run을 생성한다.",
  },
  insufficient_tools: {
    summary: "수집 범위가 부족해 문제 여부를 판단할 수 없다.",
    action: "누락되거나 inconclusive한 read-only source를 수동 확인한다.",
  },
  needs_permission: {
    summary: "필수 read-only source의 조회 권한이 부족하다.",
    action: "필수 source의 read-only 조회 권한을 요청한다.",
  },
};

const ajv = new Ajv2020({ allErrors: false, strict: false });
const reportSchema = ajv.compile<MonitoringReportV1>(JSON.parse(readFileSync(
  new URL("../../schemas/monitoring-report.schema.json", import.meta.url), "utf8",
)) as object);

function invalid(): never {
  throw new ReportAgentError("invalid_report_generation");
}

function expected(source: ReportAssemblySource, containsSecret: (value: string) => boolean): MonitoringReportV1 {
  const validators = createReportValidators({ containsSecret });
  const input = validators.input(source.input, source.context);
  const output = validators.output(source.output, source.context.runId);
  const status = resolveReportStatus(input);
  if (status !== source.resultStatus) invalid();
  if (status !== "problem_detected" && output.suspected_cause !== null) invalid();

  const evidenceByCall = new Map<string, Evidence>(
    input.evidence.map((item) => [item.tool_call_id, item]));
  const errorsByCall = new Map<string, SanitizedToolError>(
    input.tool_errors.map((item) => [item.tool_call_id, item]));
  const observations: string[] = [];
  let firstPositive: Evidence | undefined;
  for (const artifact of source.context.artifacts) {
    const evidence = evidenceByCall.get(artifact.toolCallId);
    if (evidence) {
      observations.push(`[${evidence.evidence_id}] ${evidence.summary}`);
      if (!firstPositive && evidence.assessment === "positive") firstPositive = evidence;
      continue;
    }
    const error = errorsByCall.get(artifact.toolCallId);
    if (!error || error.code === "secret_exposure_risk") invalid();
    observations.push(`[tool:${error.tool_call_id}/${error.code}] ${MESSAGES[error.code]}`);
  }
  if (observations.length === 0 || (status === "problem_detected" && !firstPositive)) invalid();

  const fixed = STATUS_TEXT[status];
  const report: MonitoringReportV1 = {
    status,
    summary: fixed.summary,
    detected_problem: status === "problem_detected" ? firstPositive!.summary : null,
    observations,
    suspected_cause: status === "problem_detected" && output.suspected_cause !== null
      ? `가능성: ${output.suspected_cause}` : null,
    recommended_next_action: fixed.action,
    needs_additional_permission: status === "needs_permission",
  };
  const serialized = JSON.stringify(report);
  if (Buffer.byteLength(serialized, "utf8") > 64 * 1024 || !reportSchema(report)) invalid();
  if (containsSecret(serialized)) throw new ReportAgentError("secret_exposure_risk");
  return report;
}

/** Pure V1 stage; persistence and Discord delivery must follow their own gates. */
export function createMonitoringReportBoundary(options: {
  readonly containsSecret: (value: string) => boolean;
}) {
  function protect(action: () => MonitoringReportV1): MonitoringReportV1 {
    try { return action(); } catch (error) {
      if (error instanceof ReportAgentError) throw new ReportAgentError(error.code);
      return invalid();
    }
  }
  return {
    assemble(source: ReportAssemblySource): MonitoringReportV1 {
      return protect(() => expected(source, options.containsSecret));
    },
    validate(report: unknown, source: ReportAssemblySource): MonitoringReportV1 {
      return protect(() => {
        if (!reportSchema(report)) invalid();
        const canonical = expected(source, options.containsSecret);
        if (!isDeepStrictEqual(report, canonical)) invalid();
        return canonical;
      });
    },
  };
}
