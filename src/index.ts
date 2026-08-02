import "dotenv/config";
import { loadConfig } from "./config/env.js";
import { startDiscordBot } from "./adapters/discord/bot.js";

const config = loadConfig();

await startDiscordBot(config);
