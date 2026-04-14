import { randomUUID } from "node:crypto";
import type { SessionContext } from "./types.js";

export interface SessionRegistry {
  issueToken(input: { agentId: string }): SessionContext;
  resolve(token: string): SessionContext | null;
  revoke(token: string): void;
}

export function createSessionRegistry(): SessionRegistry {
  const tokens = new Map<string, SessionContext>();

  return {
    issueToken(input) {
      const ctx: SessionContext = {
        token: randomUUID(),
        sessionId: randomUUID(),
        agentId: input.agentId,
      };
      tokens.set(ctx.token, ctx);
      return ctx;
    },
    resolve(token) {
      return tokens.get(token) ?? null;
    },
    revoke(token) {
      tokens.delete(token);
    },
  };
}
