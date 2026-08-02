import type { DiagnosisReport } from "../../diagnostic/types.js";

export function formatDiagnosisReport(report: DiagnosisReport): string {
  const actions = report.recommendedActions
    .map((action, index) => `${index + 1}. ${action}`)
    .join("\n");

  const message = [
    "## AMDC Diagnostic Report",
    "",
    `**Status:** ${report.status}`,
    `**Summary:** ${report.summary}`,
    `**Suspected Cause:** ${report.suspectedCause}`,
    "",
    "**Recommended Actions**",
    actions
  ].join("\n");

  return truncateDiscordMessage(message);
}

function truncateDiscordMessage(message: string): string {
  const maxLength = 1900;

  if (message.length <= maxLength) {
    return message;
  }

  return `${message.slice(0, maxLength)}\n\n...truncated`;
}
