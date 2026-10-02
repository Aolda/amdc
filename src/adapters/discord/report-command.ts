import type { DiagnosisRequest } from "../../diagnostic/types.js";
import type { MvpReport } from "../../report-agent/mvp-report.js";
import { formatMvpDiscordReport } from "../../reports/mvp-discord-formatter.js";

export interface ReportInteraction {
  readonly id: string;
  readonly guildId: string | null;
  readonly createdTimestamp: number;
  readonly user: { readonly username: string };
  readonly options: { getString(name: string, required: true): string };
  deferReply(): Promise<unknown>;
  editReply(payload: { content: string; allowedMentions: { parse: never[] }; files?: { attachment: Buffer; name: string }[] }): Promise<unknown>;
}

export interface ReportCommandDependencies {
  readonly guildId: string;
  readonly runnerMode: "mock" | "langchain";
  readonly runReport: (request: DiagnosisRequest) => Promise<MvpReport>;
  readonly containsSecret: (value: string) => boolean;
  readonly log: (event: { event: string; diagnosis_id?: string; attempt_count: 0 | 1 }) => void;
  readonly now?: () => number;
}

const MOCK_MESSAGE = "[MOCK 연결 확인] Discord 연결이 확인되었습니다. 진단을 실행하거나 리포트를 저장하지 않았습니다.";
const FAILURE_MESSAGE = "AMDC 보고서 응답을 준비하지 못했습니다. 서버 설정과 저장된 진단 기록을 확인해주세요.";
const INTERACTION_LIFETIME = 15 * 60 * 1000;

/** Claims are bounded and process-local. Delivery errors never trigger another editReply. */
export function createReportCommandHandler(dependencies: ReportCommandDependencies) {
  const claimed = new Map<string, number>();
  const now = dependencies.now ?? Date.now;
  const log = (event: Parameters<ReportCommandDependencies["log"]>[0]) => {
    try { dependencies.log(event); } catch { /* Logging cannot retry a delivery. */ }
  };
  return async (interaction: ReportInteraction): Promise<void> => {
    const time = now();
    for (const [id, expiry] of claimed) if (expiry <= time) claimed.delete(id);
    if (interaction.guildId !== dependencies.guildId || claimed.has(interaction.id)
      || !Number.isFinite(interaction.createdTimestamp)
      || interaction.createdTimestamp > time + 5000
      || interaction.createdTimestamp + INTERACTION_LIFETIME <= time || claimed.size >= 1024) return;
    claimed.set(interaction.id, interaction.createdTimestamp + INTERACTION_LIFETIME);
    try { await interaction.deferReply(); } catch {
      log({ event: "discord_ack_unconfirmed", attempt_count: 0 });
      return;
    }
    let payload: Parameters<ReportInteraction["editReply"]>[0];
    let diagnosisId: string | undefined;
    try {
      if (dependencies.runnerMode === "mock") {
        payload = { content: MOCK_MESSAGE, allowedMentions: { parse: [] } };
      } else {
        const report = await dependencies.runReport({
          symptom: interaction.options.getString("symptom", true),
          requestedBy: interaction.user.username,
          source: "discord",
          receivedAt: new Date(time).toISOString(),
        });
        diagnosisId = report.diagnosis_id;
        payload = formatMvpDiscordReport(report, dependencies.containsSecret);
      }
    } catch {
      log({ event: "report_generation_or_format_failed", attempt_count: 0 });
      payload = { content: FAILURE_MESSAGE, allowedMentions: { parse: [] } };
    }
    if (now() >= interaction.createdTimestamp + INTERACTION_LIFETIME) {
      log({ event: "discord_delivery_expired", diagnosis_id: diagnosisId, attempt_count: 0 });
      return;
    }
    try {
      await interaction.editReply(payload);
      log({ event: "discord_delivered", diagnosis_id: diagnosisId, attempt_count: 1 });
    } catch {
      // Network/SDK errors can occur after Discord accepted the message.
      log({ event: "discord_delivery_unconfirmed", diagnosis_id: diagnosisId, attempt_count: 1 });
    }
  };
}
