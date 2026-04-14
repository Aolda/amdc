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

export const plugins = sqliteTable("plugins", {
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

export const agentPlugins = sqliteTable(
  "agent_plugins",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    pluginName: text("plugin_name")
      .notNull()
      .references(() => plugins.name, { onDelete: "cascade" }),
    levelOverride: integer("level_override"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.agentId, table.pluginName] }),
  }),
);
