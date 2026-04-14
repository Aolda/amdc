import { type Router, Router as createRouter } from "express";
import type { DB } from "../db/index.js";
import type { MarkdownStore } from "../storage/markdown.js";
import {
  createAgent,
  findAllAgents,
  findAgentById,
  updateAgent,
  deleteAgent,
} from "../agents/repository.js";

export function createAgentsRouter(db: DB, store: MarkdownStore): Router {
  const router: Router = createRouter();

  router.get("/", async (_req, res) => {
    const data = await findAllAgents(db, store);
    res.json({ data });
  });

  router.get("/:id", async (req, res) => {
    const agent = await findAgentById(db, store, req.params.id);
    if (!agent) {
      res.status(404).json({ error: { message: "Agent not found" } });
      return;
    }
    res.json({ data: agent });
  });

  router.post("/", async (req, res) => {
    const { name, description, body, skillIds, subAgentIds, plugins } =
      req.body;
    if (!name || body === undefined) {
      res.status(400).json({
        error: { message: "name and body are required" },
      });
      return;
    }
    const agent = await createAgent(db, store, {
      name,
      description,
      body,
      skillIds,
      subAgentIds,
      plugins,
    });
    res.status(201).json({ data: agent });
  });

  router.put("/:id", async (req, res) => {
    const updated = await updateAgent(db, store, req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: { message: "Agent not found" } });
      return;
    }
    res.json({ data: updated });
  });

  router.delete("/:id", async (req, res) => {
    const ok = await deleteAgent(db, store, req.params.id);
    if (!ok) {
      res.status(404).json({ error: { message: "Agent not found" } });
      return;
    }
    res.status(204).send();
  });

  return router;
}
