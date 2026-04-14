import express, { type Express } from "express";
import cors from "cors";
import { healthRouter } from "./routes/health.js";
import { createScenariosRouter } from "./routes/scenarios.js";
import { createWebhooksRouter } from "./routes/webhooks.js";
import { createSettingsRouter } from "./routes/settings.js";
import { createSkillsRouter } from "./routes/skills.js";
import { createAgentsRouter } from "./routes/agents.js";
import { createPluginsRouter } from "./routes/plugins.js";
import { createMcpRouter } from "./mcp/router.js";
import type { SessionRegistry } from "./mcp/session-registry.js";
import type { PluginRegistry } from "./mcp/plugin-registry.js";
import type { PermissionChecker } from "./mcp/types.js";
import type { DB } from "./db/index.js";
import type { MarkdownStore } from "./storage/markdown.js";

export interface AppDeps {
  db: DB;
  agentStore?: MarkdownStore;
  skillStore?: MarkdownStore;
  sessionRegistry?: SessionRegistry;
  pluginRegistry?: PluginRegistry;
  permissionChecker?: PermissionChecker;
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
  app.use("/api/plugins", createPluginsRouter(deps.db));
  if (deps.sessionRegistry && deps.pluginRegistry && deps.permissionChecker) {
    app.use(
      "/mcp",
      createMcpRouter({
        sessionRegistry: deps.sessionRegistry,
        pluginRegistry: deps.pluginRegistry,
        permissionChecker: deps.permissionChecker,
      }),
    );
  }

  return app;
}
