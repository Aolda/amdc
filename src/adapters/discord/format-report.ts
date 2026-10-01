import type { DiagnosticPresentation } from "../../report/types.js";

export function formatDiagnosticPresentation(presentation: DiagnosticPresentation): string {
  return truncateDiscordMessage(buildMessage(presentation));
}

export function formatDiagnosticPresentationMessages(presentation: DiagnosticPresentation): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of buildMessage(presentation).split("\n")) {
    if (current.length + line.length + 1 > 1900 && current) {
      chunks.push(current);
      current = "";
    }
    let rest = line;
    while (rest.length > 1900) {
      const boundary = rest.lastIndexOf(" ", 1900);
      const cut = boundary > 0 ? boundary : 1900;
      chunks.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current += (current ? "\n" : "") + rest;
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildMessage(presentation: DiagnosticPresentation): string {
  const message = [
    "## AMDC 진단 인계 자료", "",
    `진단 ID: ${presentation.diagnosis_id}`,
    `요청: ${presentation.request}`,
    `종료 사유: ${presentation.completion_reason}`,
    "전체 구조화 결과: amdc-diagnosis.json 첨부 파일",
    ...presentation.observations.flatMap(call => [
      "", `**${call.seq}. ${call.plugin} / ${call.tool}**`,
      `호출 ID: ${call.tool_call_id}`,
      `조회 시각: ${call.observed_at} · 실행 상태: ${call.status}`,
      `입력: ${JSON.stringify(call.input)}`,
      `결과: ${resultPreview(call.result)}`,
      ...(call.error ? [`실행 오류: ${call.error.code} — ${call.error.message}`] : []),
      ...(call.comment?.observation ? [`관찰 comment: ${call.comment.observation}`] : []),
      ...(call.comment?.hypothesis ? [`가설 comment: ${call.comment.hypothesis}`] : []),
      ...(call.comment?.limitation ? [`한계 comment: ${call.comment.limitation}`] : []),
      ...(call.related_call_ids.length ? [`관련 호출: ${call.related_call_ids.join(", ")}`] : [])
    ]),
    ...(!presentation.observations.length ? ["", "도구 실행 결과 없음. 정상 판정을 의미하지 않습니다."] : [])
  ].join("\n");
  return message;
}

function resultPreview(result: unknown): string {
  const text = JSON.stringify(result);
  return text.length <= 600 ? text : text.slice(0, 600) + " … [표시 생략: 전체 결과는 JSON 첨부에 보존]";
}

function truncateDiscordMessage(message: string): string {
  const maxLength = 1900;
  const notice = "\n\n… 표시 길이를 초과했습니다. 전체 조사 내용은 진단 결과에 보존됩니다.";
  return message.length <= maxLength ? message : message.slice(0, maxLength - notice.length) + notice;
}
