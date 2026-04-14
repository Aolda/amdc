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

export interface AgentPluginLink {
  name: string;
  levelOverride: 1 | 2 | 3 | null;
}

export interface Agent {
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

export interface AgentInput {
  name: string;
  description?: string;
  body: string;
  skillIds?: string[];
  subAgentIds?: string[];
  plugins?: AgentPluginLink[];
}

export interface Plugin {
  name: string;
  kind: string;
  description: string;
  defaultLevel: 1 | 2 | 3;
}

export async function fetchPlugins(): Promise<Plugin[]> {
  const res = await fetch("/api/plugins");
  return handleResponse<Plugin[]>(res);
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
