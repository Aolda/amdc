export interface SkillRow {
  id: string;
  name: string;
  description: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  body: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  body?: string;
}
