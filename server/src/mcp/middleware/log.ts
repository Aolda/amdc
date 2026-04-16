import type { Middleware } from "./types.js";

export function logMiddleware(): Middleware {
  return async (ctx, next) => {
    const start = Date.now();
    const result = await next(ctx);
    const duration = Date.now() - start;
    console.log(
      `[tool] ${ctx.tool.definition.name} ${result.isError ? "ERR" : "OK"} ${duration}ms`,
    );
    return result;
  };
}
