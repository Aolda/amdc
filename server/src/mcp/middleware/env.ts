import { interpolateRecord } from "../interpolate.js";
import type { Middleware } from "./types.js";

export function envMiddleware(): Middleware {
  return async (ctx, next) => {
    const environment = ctx.session.environment ?? "staging";
    const route = ctx.mergedConfig.routing?.[environment] ?? {};
    const secrets = ctx.mergedConfig.secrets ?? {};
    ctx.namespaces = {
      ...ctx.namespaces,
      secret: secrets,
      route: route as Record<string, string | number | boolean | undefined>,
      ctx: {
        environment,
        session: ctx.session.sessionId,
        agentType: ctx.session.agentId,
      },
    };
    if (ctx.mergedConfig.fixedEnv) {
      ctx.mergedConfig.fixedEnv = interpolateRecord(
        ctx.mergedConfig.fixedEnv,
        ctx.namespaces,
      );
    }
    return next(ctx);
  };
}
