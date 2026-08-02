export type AmdcEnvironment = "dev" | "prod";
export type DiagnosticRunnerMode = "mock" | "langchain";

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string;
  amdcEnvironment: AmdcEnvironment;
  diagnosticRunnerMode: DiagnosticRunnerMode;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readAmdcEnvironment(): AmdcEnvironment {
  const value = process.env.AMDC_ENVIRONMENT?.trim() || "dev";

  if (value !== "dev" && value !== "prod") {
    throw new Error("AMDC_ENVIRONMENT must be one of: dev, prod");
  }

  return value;
}

function readDiagnosticRunnerMode(): DiagnosticRunnerMode {
  const value = process.env.AMDC_DIAGNOSTIC_RUNNER?.trim() || "mock";

  if (value !== "mock" && value !== "langchain") {
    throw new Error("AMDC_DIAGNOSTIC_RUNNER must be one of: mock, langchain");
  }

  return value;
}

export function loadConfig(): AppConfig {
  return {
    discordToken: readRequiredEnv("DISCORD_TOKEN"),
    discordClientId: readRequiredEnv("DISCORD_CLIENT_ID"),
    discordGuildId: readRequiredEnv("DISCORD_GUILD_ID"),
    amdcEnvironment: readAmdcEnvironment(),
    diagnosticRunnerMode: readDiagnosticRunnerMode()
  };
}
