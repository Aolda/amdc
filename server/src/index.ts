import "dotenv/config";
import { createApp } from "./app.js";
import { createDatabase } from "./db/index.js";
import { createMarkdownStore } from "./storage/markdown.js";
import { createSessionRegistry } from "./mcp/session-registry.js";
import { createPluginRegistry } from "./mcp/plugin-registry.js";
import { AgentDefaultPermissionChecker } from "./mcp/permission.js";
import { syncPluginsToDb } from "./mcp/plugin-sync.js";
import { echoMeta } from "./mcp/plugins/echo.js";
import { findAgentById, findAllAgents } from "./agents/repository.js";

const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || "file:./data/amdc.db";
const AGENTS_DIR = process.env.AGENTS_DIR || "./data/agents";
const SKILLS_DIR = process.env.SKILLS_DIR || "./data/skills";

async function main() {
  const db = await createDatabase(DB_PATH);
  const agentStore = createMarkdownStore(AGENTS_DIR);
  const skillStore = createMarkdownStore(SKILLS_DIR);

  const pluginMetas = [echoMeta];
  await syncPluginsToDb(db, pluginMetas);
  const pluginRegistry = createPluginRegistry(pluginMetas);
  const sessionRegistry = createSessionRegistry();
  const permissionChecker = new AgentDefaultPermissionChecker({
    getAgent: async (agentId) => {
      const row = await findAgentById(db, agentStore, agentId);
      return row ? { id: row.id, plugins: row.plugins } : null;
    },
  });

  if (process.env.NODE_ENV !== "production") {
    const allAgents = await findAllAgents(db, agentStore);
    if (allAgents.length > 0) {
      const devCtx = sessionRegistry.issueToken({ agentId: allAgents[0].id });
      console.log(
        `[mcp] dev token for agent '${allAgents[0].name}': ${devCtx.token}`,
      );
    } else {
      console.log(
        "[mcp] no agents exist; create one via /api/agents to get a dev token",
      );
    }
  }

  const app = createApp({
    db,
    agentStore,
    skillStore,
    sessionRegistry,
    pluginRegistry,
    permissionChecker,
  });

  app.listen(PORT, () => {
    console.log(`AMDC Server running on port ${PORT}`);
  });
}

main();
