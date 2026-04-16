import { maskSecrets } from "../interpolate.js";
import type { Middleware } from "./types.js";

export function secretMaskMiddleware(): Middleware {
  return async (ctx, next) => {
    const result = await next(ctx);
    const secrets = ctx.mergedConfig.secrets;
    if (!secrets || Object.keys(secrets).length === 0) return result;
    return {
      ...result,
      content: result.content.map((c) =>
        c.type === "text" ? { ...c, text: maskSecrets(c.text, secrets) } : c,
      ),
    };
  };
}
