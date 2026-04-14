import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { DB } from "../db/index.js";
import { settings } from "../db/schema.js";

const WEBHOOK_AUTH_KEY = "webhook_auth_key";
const AGENT_SYSTEM_PROMPT = "agent_system_prompt";

function generateAuthKey(): string {
  return `sk-${randomBytes(24).toString("hex")}`;
}

export async function getSetting(
  db: DB,
  key: string,
): Promise<string | undefined> {
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  return rows[0]?.value;
}

export async function setSetting(
  db: DB,
  key: string,
  value: string,
): Promise<void> {
  const now = new Date().toISOString();
  const rows = await db.select().from(settings).where(eq(settings.key, key));

  if (rows[0]) {
    await db
      .update(settings)
      .set({ value, updatedAt: now })
      .where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value, updatedAt: now });
  }
}

export async function getWebhookAuthKey(db: DB): Promise<string> {
  const existing = await getSetting(db, WEBHOOK_AUTH_KEY);
  if (existing) return existing;

  const key = generateAuthKey();
  await setSetting(db, WEBHOOK_AUTH_KEY, key);
  return key;
}

export async function regenerateWebhookAuthKey(db: DB): Promise<string> {
  const key = generateAuthKey();
  await setSetting(db, WEBHOOK_AUTH_KEY, key);
  return key;
}

export async function getAgentSystemPrompt(db: DB): Promise<string> {
  return (await getSetting(db, AGENT_SYSTEM_PROMPT)) ?? "";
}

export async function setAgentSystemPrompt(
  db: DB,
  value: string,
): Promise<void> {
  await setSetting(db, AGENT_SYSTEM_PROMPT, value);
}
