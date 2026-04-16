import type { Middleware } from "./types.js";

export function fixedParamsMiddleware(): Middleware {
  return async (ctx, next) => {
    const fixed = ctx.mergedConfig.fixedParams;
    if (fixed) {
      ctx.input = { ...ctx.input, ...fixed };
    }
    return next(ctx);
  };
}
