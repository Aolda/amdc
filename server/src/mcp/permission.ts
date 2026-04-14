import type {
  AgentLike,
  AllowListProvider,
  Mcp,
  PermissionChecker,
  PermissionDecision,
  SessionContext,
  ToolDefinition,
  ToolLevel,
} from "./types.js";

export class AllowAllPermissionChecker implements PermissionChecker {
  async check(
    _ctx: SessionContext,
    _mcp: Mcp,
    _tool: ToolDefinition,
  ): Promise<PermissionDecision> {
    return { allowed: true };
  }
}

export class AlwaysDenyAllowListProvider implements AllowListProvider {
  async isApproved(): Promise<boolean> {
    return false;
  }
}

export interface AgentDefaultPermissionCheckerDeps {
  getAgent: (agentId: string) => Promise<AgentLike | null>;
  allowListProvider?: AllowListProvider;
  getToolDefaultLevel?: (
    mcpName: string,
    toolName: string,
  ) => Promise<ToolLevel | null>;
}

export class AgentDefaultPermissionChecker implements PermissionChecker {
  private readonly getAgent: AgentDefaultPermissionCheckerDeps["getAgent"];
  private readonly allowListProvider: AllowListProvider;
  private readonly getToolDefaultLevel?: AgentDefaultPermissionCheckerDeps["getToolDefaultLevel"];

  constructor(deps: AgentDefaultPermissionCheckerDeps) {
    this.getAgent = deps.getAgent;
    this.allowListProvider =
      deps.allowListProvider ?? new AlwaysDenyAllowListProvider();
    this.getToolDefaultLevel = deps.getToolDefaultLevel;
  }

  async check(
    ctx: SessionContext,
    mcp: Mcp,
    tool: ToolDefinition,
  ): Promise<PermissionDecision> {
    const agent = await this.getAgent(ctx.agentId);
    if (!agent) {
      return { allowed: false, reason: "agent not found" };
    }
    const link = agent.mcps.find((m) => m.name === mcp.name);
    if (!link) {
      return { allowed: false, reason: "mcp not in agent allow list" };
    }
    let baseLevel: ToolLevel = tool.level;
    if (this.getToolDefaultLevel) {
      const dbLevel = await this.getToolDefaultLevel(mcp.name, tool.name);
      if (dbLevel !== null) baseLevel = dbLevel;
    }
    const effectiveLevel: ToolLevel = resolveEffectiveLevel(link, {
      ...tool,
      level: baseLevel,
    });
    if (effectiveLevel === 3) {
      return { allowed: true };
    }
    const approved = await this.allowListProvider.isApproved(
      ctx,
      mcp.name,
      tool.name,
    );
    if (approved) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `level ${effectiveLevel} requires approval`,
    };
  }
}

export function resolveEffectiveLevel(
  link: AgentLike["mcps"][number],
  tool: ToolDefinition,
): ToolLevel {
  const toolOverride = link.toolOverrides.find((t) => t.toolName === tool.name);
  if (toolOverride) return toolOverride.level;
  if (link.levelOverride !== null) return link.levelOverride;
  return tool.level;
}
