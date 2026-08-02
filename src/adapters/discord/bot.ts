import {
  ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes
} from "discord.js";
import type { AppConfig } from "../../config/env.js";
import { runDiagnosis } from "../../app/run-diagnosis.js";
import { buildDiagnoseCommand } from "./commands.js";
import { formatDiagnosisReport } from "./format-report.js";

export async function startDiscordBot(config: AppConfig): Promise<void> {
  await registerSlashCommands(config);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds]
  });

  client.once(Events.ClientReady, (readyClient) => {
    console.log(`AMDC Discord bot logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName !== "diagnose") {
      return;
    }

    await handleDiagnoseCommand(interaction, config);
  });

  await client.login(config.discordToken);
}

async function registerSlashCommands(config: AppConfig): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const command = buildDiagnoseCommand();

  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body: [command.toJSON()] }
  );

  console.log(`Registered /diagnose for guild ${config.discordGuildId}`);
}

async function handleDiagnoseCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig
): Promise<void> {
  await interaction.deferReply();

  try {
    const symptom = interaction.options.getString("symptom", true);

    const result = await runDiagnosis(
      {
        symptom,
        requestedBy: interaction.user.username,
        source: "discord",
        receivedAt: new Date().toISOString()
      },
      {
        environment: config.amdcEnvironment,
        runnerMode: config.diagnosticRunnerMode
      }
    );

    await interaction.editReply(formatDiagnosisReport(result.report));
  } catch (error) {
    console.error("Failed to handle /diagnose interaction", error);
    await interaction.editReply(
      "AMDC 진단 요청 처리 중 오류가 발생했습니다. 서버 로그를 확인해주세요."
    );
  }
}
