export interface Scenario {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  requireAuth: boolean;
  enabled: boolean;
  invocationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Invocation {
  id: string;
  scenarioId: string;
  status: string;
  alertCount: number;
  payload: Record<string, unknown>;
  prompts: string[];
  createdAt: string;
}

export interface CreateScenarioInput {
  name: string;
  description?: string;
  promptTemplate: string;
}

export interface UpdateScenarioInput {
  name?: string;
  description?: string;
  promptTemplate?: string;
  enabled?: boolean;
}

const BASE = "/api/scenarios";

async function handleResponse<T>(res: Response): Promise<T> {
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "Request failed");
  return json.data as T;
}

export async function fetchScenarios(): Promise<Scenario[]> {
  const res = await fetch(BASE);
  return handleResponse<Scenario[]>(res);
}

export async function fetchScenario(id: string): Promise<Scenario> {
  const res = await fetch(`${BASE}/${id}`);
  return handleResponse<Scenario>(res);
}

export async function createScenario(
  input: CreateScenarioInput,
): Promise<Scenario> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Scenario>(res);
}

export async function updateScenario(
  id: string,
  input: UpdateScenarioInput,
): Promise<Scenario> {
  const res = await fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Scenario>(res);
}

export async function deleteScenario(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}

export async function fetchWebhookAuthKey(): Promise<string> {
  const res = await fetch("/api/settings/webhook-auth-key");
  const data = await handleResponse<{ key: string }>(res);
  return data.key;
}

export async function regenerateWebhookAuthKey(): Promise<string> {
  const res = await fetch("/api/settings/webhook-auth-key/regenerate", {
    method: "POST",
  });
  const data = await handleResponse<{ key: string }>(res);
  return data.key;
}

export async function fetchInvocations(
  scenarioId: string,
  limit = 50,
  offset = 0,
): Promise<Invocation[]> {
  const res = await fetch(
    `${BASE}/${scenarioId}/invocations?limit=${limit}&offset=${offset}`,
  );
  return handleResponse<Invocation[]>(res);
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillInput {
  name: string;
  description?: string;
  body: string;
}

export async function fetchSkills(): Promise<Skill[]> {
  const res = await fetch("/api/skills");
  return handleResponse<Skill[]>(res);
}

export async function fetchSkill(id: string): Promise<Skill> {
  const res = await fetch(`/api/skills/${id}`);
  return handleResponse<Skill>(res);
}

export async function createSkill(input: SkillInput): Promise<Skill> {
  const res = await fetch("/api/skills", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Skill>(res);
}

export async function updateSkill(
  id: string,
  input: Partial<SkillInput>,
): Promise<Skill> {
  const res = await fetch(`/api/skills/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Skill>(res);
}

export async function deleteSkill(id: string): Promise<void> {
  const res = await fetch(`/api/skills/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}

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

export interface Agent {
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

export interface AgentInput {
  name: string;
  description?: string;
  body: string;
  skillIds?: string[];
  subAgentIds?: string[];
  mcps?: AgentMcpLink[];
}

export interface Mcp {
  name: string;
  kind: string;
  description: string;
  defaultLevel: ToolLevel;
  upstreamUrl?: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  level: ToolLevel;
}

export async function fetchMcps(): Promise<Mcp[]> {
  const res = await fetch("/api/mcps");
  return handleResponse<Mcp[]>(res);
}

export async function fetchMcpTools(
  name: string,
): Promise<McpToolDefinition[]> {
  const res = await fetch(`/api/mcps/${encodeURIComponent(name)}/tools`);
  return handleResponse<McpToolDefinition[]>(res);
}

export async function updateMcpToolLevel(
  mcpName: string,
  toolName: string,
  level: ToolLevel,
): Promise<McpToolDefinition> {
  const res = await fetch(
    `/api/mcps/${encodeURIComponent(mcpName)}/tools/${encodeURIComponent(toolName)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level }),
    },
  );
  return handleResponse<McpToolDefinition>(res);
}

export interface CreateMcpInput {
  name: string;
  description?: string;
  defaultLevel: ToolLevel;
  upstreamUrl: string;
}

export interface UpdateMcpInput {
  description?: string;
  defaultLevel?: ToolLevel;
  upstreamUrl?: string;
}

export async function createMcp(input: CreateMcpInput): Promise<Mcp> {
  const res = await fetch("/api/mcps", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Mcp>(res);
}

export async function updateMcp(
  name: string,
  input: UpdateMcpInput,
): Promise<Mcp> {
  const res = await fetch(`/api/mcps/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Mcp>(res);
}

export async function deleteMcp(name: string): Promise<void> {
  const res = await fetch(`/api/mcps/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Delete failed");
}

export async function fetchAgents(): Promise<Agent[]> {
  const res = await fetch("/api/agents");
  return handleResponse<Agent[]>(res);
}

export async function fetchAgent(id: string): Promise<Agent> {
  const res = await fetch(`/api/agents/${id}`);
  return handleResponse<Agent>(res);
}

export async function createAgent(input: AgentInput): Promise<Agent> {
  const res = await fetch("/api/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Agent>(res);
}

export async function updateAgent(
  id: string,
  input: Partial<AgentInput>,
): Promise<Agent> {
  const res = await fetch(`/api/agents/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return handleResponse<Agent>(res);
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Delete failed");
}

export async function fetchAgentSystemPrompt(): Promise<string> {
  const res = await fetch("/api/settings/agent-system-prompt");
  const data = await handleResponse<{ value: string }>(res);
  return data.value;
}

export async function updateAgentSystemPrompt(value: string): Promise<void> {
  const res = await fetch("/api/settings/agent-system-prompt", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  await handleResponse<{ value: string }>(res);
}
