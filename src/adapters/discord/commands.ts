import { SlashCommandBuilder } from "discord.js";

export function buildDiagnoseCommand() {
  return new SlashCommandBuilder()
    .setName("diagnose")
    .setDescription("AMDC 진단 요청을 생성합니다.")
    .addStringOption((option) =>
      option
        .setName("symptom")
        .setDescription("발생한 문제 상황")
        .setRequired(true)
        .setMaxLength(2000)
    );
}
