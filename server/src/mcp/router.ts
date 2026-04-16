import { Router, type Router as ExpressRouter } from "express";
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions,
} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface McpRouterDeps {
  proxyServer: Server;
}

export function createMcpRouter(deps: McpRouterDeps): ExpressRouter {
  const router: ExpressRouter = Router();
  const { proxyServer } = deps;

  router.post("/", async (req, res) => {
    const transportOptions: StreamableHTTPServerTransportOptions = {
      sessionIdGenerator: undefined,
    };
    const transport = new StreamableHTTPServerTransport(transportOptions);
    res.on("close", async () => {
      try {
        await transport.close();
      } catch {
        // ignore transport close errors on connection drop
      }
    });
    await proxyServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  return router;
}
