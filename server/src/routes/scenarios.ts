import { type Router, Router as createRouter } from "express";
import type { AppDeps } from "../app.js";
import {
  createScenario,
  findAllScenarios,
  findScenarioById,
  updateScenario,
  deleteScenario,
} from "../scenarios/repository.js";
import {
  findInvocationsByScenarioId,
  countInvocationsByScenarioId,
} from "../invocations/repository.js";

export function createScenariosRouter(deps: AppDeps): Router {
  const router: Router = createRouter();
  const { db } = deps;

  router.get("/", async (_req, res) => {
    const all = await findAllScenarios(db);
    const data = await Promise.all(
      all.map(async (s) => ({
        ...s,
        invocationCount: await countInvocationsByScenarioId(db, s.id),
      })),
    );
    res.json({ data });
  });

  router.get("/:id", async (req, res) => {
    const scenario = await findScenarioById(db, req.params.id);
    if (!scenario) {
      res.status(404).json({ error: { message: "Scenario not found" } });
      return;
    }
    res.json({
      data: {
        ...scenario,
        invocationCount: await countInvocationsByScenarioId(db, scenario.id),
      },
    });
  });

  router.get("/:id/invocations", async (req, res) => {
    const scenario = await findScenarioById(db, req.params.id);
    if (!scenario) {
      res.status(404).json({ error: { message: "Scenario not found" } });
      return;
    }
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const data = await findInvocationsByScenarioId(
      db,
      scenario.id,
      limit,
      offset,
    );
    res.json({ data });
  });

  router.post("/", async (req, res) => {
    const { name, description, promptTemplate } = req.body;

    if (!name || !promptTemplate) {
      res.status(400).json({
        error: { message: "name and promptTemplate are required" },
      });
      return;
    }

    const scenario = await createScenario(db, {
      name,
      description,
      promptTemplate,
    });
    res.status(201).json({ data: scenario });
  });

  router.put("/:id", async (req, res) => {
    const existing = await findScenarioById(db, req.params.id);
    if (!existing) {
      res.status(404).json({ error: { message: "Scenario not found" } });
      return;
    }

    const updated = await updateScenario(db, req.params.id, req.body);
    res.json({ data: updated });
  });

  router.delete("/:id", async (req, res) => {
    const deleted = await deleteScenario(db, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: { message: "Scenario not found" } });
      return;
    }
    res.status(204).send();
  });

  return router;
}
