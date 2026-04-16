import type { SessionContext, ToolCallResult } from "../types.js";
import type { WrapperConfig } from "../wrapper.js";
import type { InterpolationNamespaces } from "../interpolate.js";
import type { ComposedTool } from "../dispatch.js";

export interface ToolCallContext {
  session: SessionContext;
  tool: ComposedTool;
  input: Record<string, unknown>;
  mergedConfig: WrapperConfig;
  namespaces: InterpolationNamespaces;
}

export type ToolCallNext = (ctx: ToolCallContext) => Promise<ToolCallResult>;

export type Middleware = (
  ctx: ToolCallContext,
  next: ToolCallNext,
) => Promise<ToolCallResult>;

export function composeMiddleware(
  middlewares: Middleware[],
  final: ToolCallNext,
): ToolCallNext {
  let handler = final;
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const mw = middlewares[i];
    const downstream = handler;
    handler = (ctx) => mw(ctx, downstream);
  }
  return handler;
}
