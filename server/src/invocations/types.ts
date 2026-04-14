export interface CreateInvocationInput {
  scenarioId: string;
  status: string;
  alertCount: number;
  payload: Record<string, unknown>;
  prompts: string[];
}

export interface InvocationRow {
  id: string;
  scenarioId: string;
  status: string;
  alertCount: number;
  payload: Record<string, unknown>;
  prompts: string[];
  createdAt: string;
}
