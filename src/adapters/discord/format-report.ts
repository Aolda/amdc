import type { DiagnosticPresentation } from "../../report/types.js";

export function formatDiagnosticPresentation(presentation: DiagnosticPresentation): string {
  const actions = presentation.recommendedActions
    .map((action, index) => `${index + 1}. ${action}`)
    .join("\n");

  const message = [
    "## AMDC Diagnostic Agent Result",
    "",
    `**Status:** ${presentation.status}`,
    `**Summary:** ${presentation.summary}`,
    `**Suspected Cause:** ${presentation.suspectedCause}`,
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
