import type { PermissionChecker } from "../types.js";
import type { Middleware } from "./types.js";

export function authMiddleware(checker: PermissionChecker): Middleware {
  return async (ctx, next) => {
    const decision = await checker.check(
      ctx.session,
      ctx.tool.mcp,
      ctx.tool.definition,
    );
    if (!decision.allowed) {
      const suffix = decision.reason ? ": " + decision.reason : "";
      return {
        content: [{ type: "text", text: "permission denied" + suffix }],
        isError: true,
      };
    }
    return next(ctx);
  };
}
