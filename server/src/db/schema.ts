import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";

export const scenarios = sqliteTable("scenarios", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  promptTemplate: text("prompt_template").notNull(),
  requireAuth: integer("require_auth").notNull().default(1),
  enabled: integer("enabled").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const invocations = sqliteTable("invocations", {
  id: text("id").primaryKey(),
  scenarioId: text("scenario_id").notNull(),
  status: text("status").notNull(),
  alertCount: integer("alert_count").notNull(),
  payload: text("payload").notNull(),
  prompts: text("prompts").notNull(),
  createdAt: text("created_at").notNull(),
});

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentSkills = sqliteTable(
  "agent_skills",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    skillId: text("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.skillId] }),
  }),
);

export const mcps = sqliteTable("mcps", {
  name: text("name").primaryKey(),
  kind: text("kind").notNull(),
  description: text("description").notNull().default(""),
  defaultLevel: integer("default_level").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentSubAgents = sqliteTable(
  "agent_sub_agents",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    subAgentId: text("sub_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.subAgentId] }),
  }),
);

export const agentMcps = sqliteTable(
  "agent_mcps",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    mcpName: text("mcp_name")
      .notNull()
      .references(() => mcps.name, { onDelete: "cascade" }),
    levelOverride: integer("level_override"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.mcpName] }),
  }),
);

export const mcpTools = sqliteTable(
  "mcp_tools",
  {
    mcpName: text("mcp_name")
      .notNull()
      .references(() => mcps.name, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    level: integer("level").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.mcpName, table.toolName] }),
  }),
);

export const agentMcpTools = sqliteTable(
  "agent_mcp_tools",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    mcpName: text("mcp_name")
      .notNull()
      .references(() => mcps.name, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    levelOverride: integer("level_override").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.agentId, table.mcpName, table.toolName],
    }),
  }),
);
