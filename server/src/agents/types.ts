export type ToolLevel = 1 | 2 | 3;

export interface AgentMcpToolOverride {
  toolName: string;
  level: ToolLevel;
}

export interface AgentMcpLink {
  name: string;
  levelOverride: ToolLevel | null;
  toolOverrides: AgentMcpToolOverride[];
}

export interface AgentRow {
  id: string;
  name: string;
  description: string;
  body: string;
  skillIds: string[];
  subAgentIds: string[];
  mcps: AgentMcpLink[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  body: string;
  skillIds?: string[];
  subAgentIds?: string[];
  mcps?: AgentMcpLink[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  body?: string;
  skillIds?: string[];
  subAgentIds?: string[];
  mcps?: AgentMcpLink[];
}
