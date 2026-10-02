import { validateMvpReport, type MvpReport } from "../report-agent/mvp-report.js";

const LIMIT = 1900;

function preview(value: string, length: number): string {
  if (value.length <= length) return value;
  let result = "";
  for (const point of value) {
    if (result.length + point.length > length - 1) break;
    result += point;
  }
  return result + "…";
}

function plain(value: string): string {
  // Keep data from impersonating headings, mentions, links or Markdown controls.
  return value.replace(/[\\`*~|<>\[\]#]/g, "").replace(/_/g, "\\_").replace(/@/g, "＠").replace(/[\r\n]+/g, " ");
}

/** One bounded Discord summary and one full, sanitized report attachment. */
export function formatMvpDiscordReport(value: MvpReport, containsSecret: (value: string) => boolean) {
  const report = validateMvpReport(value, containsSecret);
  const success = report.observations.filter(item => item.status === "success").length;
  const failed = report.observations.length - success;
  const overview = [
    "AMDC 진단 보고서",
    `진단 ID: ${report.diagnosis_id}`,
    `조사 종료: ${report.completion_reason === "investigation_complete" ? "진단 에이전트 조사 종료" : "판단 근거 부족"}`,
    `호출 ${report.observations.length}건 · 조회 성공 ${success}건 · 조회 실패 ${failed}건`,
    plain(report.summary),
    "조회 성공이나 조사 종료는 시스템 정상·원인 확정을 뜻하지 않습니다.",
  ];
  const cause = report.suspected_cause === null ? "판단 근거 부족" : plain(report.suspected_cause);
  const details = report.observations.flatMap(item => [
    `### ${item.seq}. ${plain(item.tool)} (${item.status === "success" ? "조회 성공" : "조회 실패"})`,
    `근거: ${item.tool_call_id} · ${item.observed_at}`,
    plain(item.execution_summary),
    ...(item.diagnostic_comment?.observation ? [`진단 에이전트 해석: ${plain(item.diagnostic_comment.observation)}`] : []),
    ...(item.diagnostic_comment?.hypothesis ? [`진단 에이전트 가설: ${plain(item.diagnostic_comment.hypothesis)}`] : []),
    ...(item.diagnostic_comment?.limitation ? [`진단 에이전트 한계: ${plain(item.diagnostic_comment.limitation)}`] : []),
    ...(item.related_call_ids.length ? [`관련 호출: ${item.related_call_ids.join(", ")}`] : []),
    "",
  ]);
  const markdown = [
    "# AMDC 진단 보고서", "",
    "요약: 수집된 호출 기록과 진단 에이전트의 해석을 바탕으로 작성한 MVP 보고서입니다. 조회 성공, 원인 가설, 조사 한계를 구분하며 시스템 전체의 정상 여부는 확정하지 않습니다.", "",
    ...overview.slice(1), "",
    "## Report Agent의 원인 가설", cause, "",
    "## 조사 한계", ...report.limitations.map(item => `- ${plain(item)}`), "",
    "## 호출 기록과 진단 해석", ...details,
    "## 후속 확인", plain(report.recommended_next_action), "",
  ].join("\n");
  const content = [
    ...overview,
    `원인 가설: ${preview(cause, 310)}`,
    `한계: ${preview(report.limitations.map(plain).join(" / "), 360)}`,
    ...report.observations.slice(0, 2).map(item =>
      `[call-${item.seq}] ${plain(item.tool)}: ${preview(plain(item.execution_summary), 100)}`),
    "전체 호출 기록과 진단 해석은 첨부 보고서에서 확인하세요.",
  ].join("\n");
  if (content.length > LIMIT || Buffer.byteLength(markdown, "utf8") > 256 * 1024
    || containsSecret(content) || containsSecret(markdown)) {
    throw new Error("discord_format_failed");
  }
  return {
    content,
    files: [{ attachment: Buffer.from(markdown, "utf8"), name: "amdc-report.md" }],
    allowedMentions: { parse: [] as never[] },
  };
}
