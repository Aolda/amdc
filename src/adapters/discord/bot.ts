import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes
} from "discord.js";
import type { AppConfig } from "../../config/env.js";
import { runDiagnosis } from "../../app/run-diagnosis.js";
import { buildDiagnoseCommand } from "./commands.js";
import { createReportFlow } from "../../app/report-flow.js";
import { createOpenAIReportModel } from "../../report-agent/openai-report-model.js";
import { createSecretDetector } from "../../report-agent/security.js";
import { createFileMvpReportStore } from "../../reports/mvp-report-store.js";
import { createReportCommandHandler } from "./report-command.js";

/** One application delivery attempt must remain one SDK HTTP attempt on 5xx. */
export function createDiscordClient(): Client {
  return new Client({ intents: [GatewayIntentBits.Guilds], rest: { retries: 0 } });
}

export function createDiscordRegistrationRest(token: string): REST {
  return new REST({ version: "10", retries: 0 }).setToken(token);
}

export async function startDiscordBot(config: AppConfig): Promise<void> {
  const containsSecret = createSecretDetector(Object.entries(process.env)
    .filter(([key, value]) => /TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY|SESSION/i.test(key) && value)
    .map(([, value]) => value!));
  const flow = config.diagnosticRunnerMode === "langchain" ? createReportFlow({
    diagnose: runDiagnosis,
    model: createOpenAIReportModel(config),
    store: createFileMvpReportStore(config.reportDirectory ?? "./data/reports", containsSecret),
    containsSecret,
  }) : undefined;
  const handleDiagnoseCommand = createReportCommandHandler({
    guildId: config.discordGuildId,
    runnerMode: config.diagnosticRunnerMode,
    containsSecret,
    runReport: request => {
      if (!flow) throw new Error("report_runner_unavailable");
      return flow(request, {
        environment: config.amdcEnvironment,
        runnerMode: config.diagnosticRunnerMode,
        agentModel: config.agentModel,
        openaiApiKey: config.openaiApiKey,
        openaiBaseUrl: config.openaiBaseUrl,
      });
    },
    log: event => console.log(JSON.stringify(event)),
  });
  await registerSlashCommands(config);

  const client = createDiscordClient();

  client.once(Events.ClientReady, () => {
    console.log("AMDC Discord bot ready");
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    if (interaction.commandName !== "diagnose") {
      return;
    }

    await handleDiagnoseCommand(interaction);
  });

  await client.login(config.discordToken);
}

async function registerSlashCommands(config: AppConfig): Promise<void> {
  const rest = createDiscordRegistrationRest(config.discordToken);
  const command = buildDiagnoseCommand();

  await rest.put(
    Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
    { body: [command.toJSON()] }
  );

  console.log("Registered /diagnose");
}
