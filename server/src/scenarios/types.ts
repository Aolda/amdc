export interface CreateScenarioInput {
  name: string;
  description?: string;
  promptTemplate: string;
  requireAuth?: boolean;
}

export interface UpdateScenarioInput {
  name?: string;
  description?: string;
  promptTemplate?: string;
  requireAuth?: boolean;
  enabled?: boolean;
}

export interface ScenarioRow {
  id: string;
  name: string;
  description: string;
  promptTemplate: string;
  requireAuth: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
