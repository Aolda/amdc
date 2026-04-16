import "dotenv/config";
import { createApp } from "./app.js";
import { createDatabase } from "./db/index.js";
import { createMarkdownStore } from "./storage/markdown.js";
import { createMcpRegistry } from "./mcp/mcp-registry.js";
import { LevelPermissionChecker } from "./mcp/permission.js";
import {
  loadCliMcpsFromDb,
  loadUpstreamMcpsFromDb,
  seedNativeToolLevels,
  syncMcpsToDb,
} from "./mcp/mcp-sync.js";
import { echoMeta } from "./mcp/plugins/echo.js";
import { createProxyMcpServer } from "./mcp/proxy-server.js";

const PORT = process.env.PORT || 3001;
const DB_PATH = process.env.DB_PATH || "file:./data/amdc.db";
const AGENTS_DIR = process.env.AGENTS_DIR || "./data/agents";
const SKILLS_DIR = process.env.SKILLS_DIR || "./data/skills";

async function main() {
  const db = await createDatabase(DB_PATH);
  const agentStore = createMarkdownStore(AGENTS_DIR);
  const skillStore = createMarkdownStore(SKILLS_DIR);

  const nativeMcpMetas = [echoMeta];
  await syncMcpsToDb(db, nativeMcpMetas);
  await seedNativeToolLevels(db, nativeMcpMetas);
  const upstreamMcpMetas = await loadUpstreamMcpsFromDb(db);
  const cliMcpMetas = await loadCliMcpsFromDb(db);
  const mcpRegistry = createMcpRegistry([
    ...nativeMcpMetas,
    ...upstreamMcpMetas,
    ...cliMcpMetas,
  ]);
  const permissionChecker = new LevelPermissionChecker();
  const proxyServer = createProxyMcpServer({
    registry: mcpRegistry,
    permissionChecker,
    db,
  });

  const app = createApp({
    db,
    agentStore,
    skillStore,
    mcpRegistry,
    proxyServer,
  });

  app.listen(PORT, () => {
    console.log(`AMDC Server running on port ${PORT}`);
  });
}

main();
