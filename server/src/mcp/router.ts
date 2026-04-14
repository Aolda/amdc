import { Router, type Router as ExpressRouter } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createProxyMcpServer } from "./proxy-server.js";
import type { SessionRegistry } from "./session-registry.js";
import type { McpRegistry } from "./mcp-registry.js";
import type { PermissionChecker } from "./types.js";
import type { DB } from "../db/index.js";

export interface McpRouterDeps {
  sessionRegistry: SessionRegistry;
  mcpRegistry: McpRegistry;
  permissionChecker: PermissionChecker;
  db: DB;
}

export function createMcpRouter(deps: McpRouterDeps): ExpressRouter {
  const router: ExpressRouter = Router();

  router.post("/:token", async (req, res) => {
    const ctx = deps.sessionRegistry.resolve(req.params.token);
    if (!ctx) {
      res.status(404).json({ error: { message: "Unknown MCP token" } });
      return;
    }
    const server = createProxyMcpServer(
      ctx,
      deps.mcpRegistry,
      deps.permissionChecker,
      deps.db,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", async () => {
      try {
        await transport.close();
        await server.close();
      } catch {
        // ignore transport/server close errors on connection drop
      }
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  router.get("/:token", async (req, res) => {
    const ctx = deps.sessionRegistry.resolve(req.params.token);
    if (!ctx) {
      res.status(404).json({ error: { message: "Unknown MCP token" } });
      return;
    }
    res.status(405).json({
      error: { message: "GET (SSE) not supported in stateless mode" },
    });
  });

  router.delete("/:token", async (req, res) => {
    deps.sessionRegistry.revoke(req.params.token);
    res.status(204).send();
  });

  return router;
}
