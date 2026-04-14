import { type Router, Router as createRouter } from "express";
import type { DB } from "../db/index.js";
import type { MarkdownStore } from "../storage/markdown.js";
import {
  createSkill,
  findAllSkills,
  findSkillById,
  updateSkill,
  deleteSkill,
} from "../skills/repository.js";

export function createSkillsRouter(db: DB, store: MarkdownStore): Router {
  const router: Router = createRouter();

  router.get("/", async (_req, res) => {
    const data = await findAllSkills(db, store);
    res.json({ data });
  });

  router.get("/:id", async (req, res) => {
    const skill = await findSkillById(db, store, req.params.id);
    if (!skill) {
      res.status(404).json({ error: { message: "Skill not found" } });
      return;
    }
    res.json({ data: skill });
  });

  router.post("/", async (req, res) => {
    const { name, description, body } = req.body;
    if (!name || body === undefined) {
      res.status(400).json({
        error: { message: "name and body are required" },
      });
      return;
    }
    const skill = await createSkill(db, store, {
      name,
      description,
      body,
    });
    res.status(201).json({ data: skill });
  });

  router.put("/:id", async (req, res) => {
    const updated = await updateSkill(db, store, req.params.id, req.body);
    if (!updated) {
      res.status(404).json({ error: { message: "Skill not found" } });
      return;
    }
    res.json({ data: updated });
  });

  router.delete("/:id", async (req, res) => {
    const ok = await deleteSkill(db, store, req.params.id);
    if (!ok) {
      res.status(404).json({ error: { message: "Skill not found" } });
      return;
    }
    res.status(204).send();
  });

  return router;
}
