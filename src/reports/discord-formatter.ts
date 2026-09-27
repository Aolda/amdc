import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { MonitoringReportV1 } from "./monitoring-report.js";

const MAX_CHARACTERS = 1900;
const MAX_CAUSE_PREVIEW = 300;
const RUN_ID = /^run_[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const ajv = new Ajv2020({ allErrors: false, strict: false });
const reportSchema = ajv.compile<MonitoringReportV1>(JSON.parse(readFileSync(
  new URL("../../schemas/monitoring-report.schema.json", import.meta.url), "utf8",
)) as object);

export class DiscordReportFormatError extends Error {
  readonly code = "discord_format_failed";
  constructor() {
    super("discord_format_failed");
    this.name = "DiscordReportFormatError";
  }
}

function length(value: string): number {
  return Array.from(value).length;
}

function preview(value: string): string {
  const characters = Array.from(value);
  return characters.length <= MAX_CAUSE_PREVIEW
    ? value : `${characters.slice(0, MAX_CAUSE_PREVIEW - 1).join("")}…`;
}

/** The caller must load the committed report and Run ID from persistence first. */
export function formatPersistedMonitoringReport(
  runId: string,
  report: unknown,
  containsSecret: (value: string) => boolean,
): string {
  try {
    if (!RUN_ID.test(runId) || !reportSchema(report)) throw new Error();
    if (containsSecret(JSON.stringify(report))) throw new Error();

    const fixed = [
      `상태: ${report.status}`,
      `요약: ${report.summary}`,
      ...(report.detected_problem === null ? [] : [`확인된 문제: ${report.detected_problem}`]),
    ];
    const tail = [
      ...(report.suspected_cause === null ? [] : [`원인 가설: ${preview(report.suspected_cause)}`]),
      `후속 확인: ${report.recommended_next_action}`,
      ...(report.needs_additional_permission ? ["추가 권한 필요: 예"] : []),
      `Run ID: ${runId}`,
    ];
    const render = (included: readonly string[]): string => {
      const omitted = report.observations.length - included.length;
      return [
        ...fixed,
        ...(included.length ? ["관찰 결과:", ...included.map((item) => `- ${item}`)] : []),
        ...(omitted ? [`관찰 결과 ${omitted}건 생략. 아래 Run ID로 전체 보고서를 조회하세요.`] : []),
        ...tail,
      ].join("\n");
    };

    const included: string[] = [];
    if (length(render(included)) > MAX_CHARACTERS) throw new Error();
    for (const item of report.observations) {
      const candidate = [...included, item];
      if (length(render(candidate)) > MAX_CHARACTERS) break;
      included.push(item);
    }
    const result = render(included);
    if (length(result) > MAX_CHARACTERS || containsSecret(result)) throw new Error();
    return result;
  } catch {
    // Never reflect a stored report, scanner failure, or channel text.
    throw new DiscordReportFormatError();
  }
}
