export interface AgentPluginLink {
  name: string;
  levelOverride: 1 | 2 | 3 | null;
}

export interface AgentRow {
  id: string;
  name: string;
  description: string;
  body: string;
  skillIds: string[];
  subAgentIds: string[];
  plugins: AgentPluginLink[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  body: string;
  skillIds?: string[];
  subAgentIds?: string[];
  plugins?: AgentPluginLink[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  body?: string;
  skillIds?: string[];
  subAgentIds?: string[];
  plugins?: AgentPluginLink[];
}
