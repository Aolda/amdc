import { type Router, Router as createRouter } from "express";
import type { AppDeps } from "../app.js";
import { findScenarioByName } from "../scenarios/repository.js";
import { createInvocation } from "../invocations/repository.js";
import { getWebhookAuthKey } from "../settings/repository.js";

interface GrafanaAlert {
  status: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  endsAt: string;
  generatorURL?: string;
  fingerprint?: string;
  values: Record<string, number>;
}

interface GrafanaWebhookPayload {
  status: string;
  alerts: GrafanaAlert[];
}

function flattenAlert(alert: GrafanaAlert): Record<string, unknown> {
  return {
    status: alert.status,
    startsAt: alert.startsAt,
    endsAt: alert.endsAt,
    generatorURL: alert.generatorURL,
    fingerprint: alert.fingerprint,
    ...alert.labels,
    ...alert.annotations,
    ...alert.values,
  };
}

function renderTemplate(
  template: string,
  data: Record<string, unknown>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = data[key];
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}

function buildPrompt(template: string, alert: GrafanaAlert): string {
  const rendered = renderTemplate(template, flattenAlert(alert));
  return `${rendered}\n\n--- Alert Data ---\n${JSON.stringify(alert, null, 2)}`;
}

export function createWebhooksRouter(deps: AppDeps): Router {
  const router: Router = createRouter();
  const { db } = deps;

  router.post("/", async (req, res) => {
    const payload = req.body as GrafanaWebhookPayload;
    const alerts = payload.alerts ?? [];

    const scenarioName = alerts[0]?.labels?.scenario;
    if (!scenarioName) {
      res
        .status(404)
        .json({ error: { message: "Missing scenario label in alert" } });
      return;
    }

    const scenario = await findScenarioByName(db, scenarioName);
    if (!scenario) {
      res.status(404).json({ error: { message: "Scenario not found" } });
      return;
    }

    if (scenario.requireAuth) {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ")
        ? authHeader.slice(7)
        : null;
      const validKey = await getWebhookAuthKey(db);

      if (token !== validKey) {
        res.status(401).json({ error: { message: "Invalid auth key" } });
        return;
      }
    }

    if (!scenario.enabled) {
      res.status(200).json({ data: { received: true, processed: false } });
      return;
    }

    const prompts = alerts.map((alert) =>
      buildPrompt(scenario.promptTemplate, alert),
    );

    const invocation = await createInvocation(db, {
      scenarioId: scenario.id,
      status: payload.status ?? "unknown",
      alertCount: alerts.length,
      payload: req.body as Record<string, unknown>,
      prompts,
    });

    console.log(
      `[webhook] Scenario "${scenario.name}" received ${alerts.length} alert(s) (invocation: ${invocation.id})`,
    );

    res.json({
      data: {
        received: true,
        processed: true,
        scenarioName: scenario.name,
        alertCount: alerts.length,
        prompts,
        invocationId: invocation.id,
      },
    });
  });

  return router;
}
