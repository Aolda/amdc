import express, { type Express } from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { createScenariosRouter } from "./routes/scenarios.js";
import { createWebhooksRouter } from "./routes/webhooks.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createSkillsRouter } from "./routes/skills.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createMcpsRouter } from "./routes/mcps.js";
import { createMcpRouter } from "./mcp/router.js";
import type { McpRegistry } from "./mcp/mcp-registry.js";
import type { DB } from "./db/index.js";
import type { MarkdownStore } from "./storage/markdown.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface AppDeps {
  db: DB;
  agentStore?: MarkdownStore;
  skillStore?: MarkdownStore;
  mcpRegistry?: McpRegistry;
  proxyServer?: Server;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.use(cors()); // eslint-disable-line sonarjs/cors -- CORS is intentional for frontend-server communication
  app.use(express.json());

  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      console.log(
        `[api] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`,
      );
    });
    next();
  });

  app.use("/api/health", healthRouter);
  app.use("/api/scenarios", createScenariosRouter(deps));
  app.use("/api/webhooks", createWebhooksRouter(deps));
  app.use("/api/settings", createSettingsRouter(deps));
  if (deps.skillStore) {
    app.use("/api/skills", createSkillsRouter(deps.db, deps.skillStore));
  }
  if (deps.agentStore) {
    app.use("/api/agents", createAgentsRouter(deps.db, deps.agentStore));
  }
  app.use("/api/mcps", createMcpsRouter(deps.db, deps.mcpRegistry));
  if (deps.proxyServer) {
    app.use("/mcp", createMcpRouter({ proxyServer: deps.proxyServer }));
  }

  return app;
}
