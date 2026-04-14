import { Router, type Router as ExpressRouter } from "express";
import type { DB } from "../db/index.js";
import { plugins as pluginsTable } from "../db/schema.js";

export function createPluginsRouter(db: DB): ExpressRouter {
  const router: ExpressRouter = Router();

  router.get("/", async (_req, res) => {
    const rows = await db.select().from(pluginsTable);
    const data = rows.map((row) => ({
      name: row.name,
      kind: row.kind,
      description: row.description,
      defaultLevel: row.defaultLevel,
    }));
    res.json({ data });
  });

  return router;
}
