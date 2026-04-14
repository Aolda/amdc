import type {
  AgentLike,
  AllowListProvider,
  PermissionChecker,
  PermissionDecision,
  Plugin,
  SessionContext,
  ToolLevel,
} from "./types.js";

export class AllowAllPermissionChecker implements PermissionChecker {
  async check(
    _ctx: SessionContext,
    _plugin: Plugin,
    _toolName: string,
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
}

export class AgentDefaultPermissionChecker implements PermissionChecker {
  private readonly getAgent: AgentDefaultPermissionCheckerDeps["getAgent"];
  private readonly allowListProvider: AllowListProvider;

  constructor(deps: AgentDefaultPermissionCheckerDeps) {
    this.getAgent = deps.getAgent;
    this.allowListProvider =
      deps.allowListProvider ?? new AlwaysDenyAllowListProvider();
  }

  async check(
    ctx: SessionContext,
    plugin: Plugin,
    toolName: string,
  ): Promise<PermissionDecision> {
    const agent = await this.getAgent(ctx.agentId);
    if (!agent) {
      return { allowed: false, reason: "agent not found" };
    }
    const link = agent.plugins.find((p) => p.name === plugin.name);
    if (!link) {
      return { allowed: false, reason: "plugin not in agent allow list" };
    }
    const effectiveLevel: ToolLevel = link.levelOverride ?? plugin.defaultLevel;
    if (effectiveLevel === 3) {
      return { allowed: true };
    }
    const approved = await this.allowListProvider.isApproved(
      ctx,
      plugin.name,
      toolName,
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
