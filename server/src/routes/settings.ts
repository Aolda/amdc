import { type Router, Router as createRouter } from "express";
import type { AppDeps } from "../app.js";
import {
  getWebhookAuthKey,
  regenerateWebhookAuthKey,
  getAgentSystemPrompt,
  setAgentSystemPrompt,
} from "../settings/repository.js";

export function createSettingsRouter(deps: AppDeps): Router {
  const router: Router = createRouter();
  const { db } = deps;

  router.get("/webhook-auth-key", async (_req, res) => {
    const key = await getWebhookAuthKey(db);
    res.json({ data: { key } });
  });

  router.post("/webhook-auth-key/regenerate", async (_req, res) => {
    const key = await regenerateWebhookAuthKey(db);
    res.json({ data: { key } });
  });

  router.get("/agent-system-prompt", async (_req, res) => {
    const value = await getAgentSystemPrompt(db);
    res.json({ data: { value } });
  });

  router.put("/agent-system-prompt", async (req, res) => {
    const { value } = req.body;
    if (typeof value !== "string") {
      res.status(400).json({ error: { message: "value must be a string" } });
      return;
    }
    await setAgentSystemPrompt(db, value);
    res.json({ data: { value } });
  });

  return router;
}
