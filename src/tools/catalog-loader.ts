import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { AmdcEnvironment } from "../config/env.js";
import { PLUGIN_NAMES } from "./types.js";
import type {
  JsonObjectSchema,
  PluginName,
  ToolCatalog,
  ToolDefinition,
  ToolPluginDefinition,
  ToolSource
} from "./types.js";

const allowedPluginNames = new Set<string>(PLUGIN_NAMES);
const allowedSources = new Set([
  "amdb_admin_api",
  "amdb_backend",
  "cadvisor",
  "http_health",
  "loki",
  "mysql",
  "prometheus",
  "proxysql"
]);
const allowedEnvironments = new Set(["dev", "prod"]);
const allowedExecutionTypes = new Set([
  "source_adapter",
  "local_shell",
  "prometheus_http"
]);
const environmentVariableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const templateVariableNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function loadToolCatalogFromYaml(path: string): ToolCatalog {
  const parsed = parse(readFileSync(path, "utf8")) as unknown;
  return parseToolCatalog(parsed);
}

export function parseToolCatalog(value: unknown): ToolCatalog {
  const root = asRecord(value, "tool catalog");
  const plugins = asArray(root.plugins, "plugins").map(parsePlugin);

  if (plugins.length === 0) {
    throw new Error("Tool catalog must contain at least one plugin.");
  }

  return deepFreeze({ plugins });
}

function parsePlugin(value: unknown): ToolPluginDefinition {
  const raw = asRecord(value, "plugin");
  const name = parsePluginName(raw.name);
  const description = parseNonEmptyString(raw.description, `${name}.description`);
  const domainHints = asArray(raw.domainHints, `${name}.domainHints`).map((hint, index) =>
    parseNonEmptyString(hint, `${name}.domainHints[${index}]`)
  );
  const tools = asArray(raw.tools, `${name}.tools`).map((tool) => parseTool(name, tool));

  if (tools.length === 0) {
    throw new Error(`Plugin ${name} must contain at least one tool.`);
  }

  return {
    name,
    description,
    domainHints,
    tools
  };
}

function parseTool(pluginName: PluginName, value: unknown): ToolDefinition {
  const raw = asRecord(value, `${pluginName}.tool`);
  const name = parseNonEmptyString(raw.name, `${pluginName}.tool.name`);
  const description = parseNonEmptyString(raw.description, `${name}.description`);

  const access = parseAccess(raw.access, `${name}.access`);

  const source = parseEnum(raw.source, allowedSources, `${name}.source`) as ToolSource;
  const allowedEnvironmentValues = asArray(
    raw.allowedEnvironments,
    `${name}.allowedEnvironments`
  ).map((environment, index) =>
    parseEnum(
      environment,
      allowedEnvironments,
      `${name}.allowedEnvironments[${index}]`
    ) as AmdcEnvironment
  );
  const timeoutMs = parsePositiveInteger(raw.timeoutMs, `${name}.timeoutMs`);
  const inputSchema = parseInputSchema(raw.input, `${name}.input`);
  const execution = parseExecution(
    raw.execution,
    `${name}.execution`,
    allowedEnvironmentValues
  );

  return {
    name,
    pluginName,
    description,
    access,
    source,
    allowedEnvironments: allowedEnvironmentValues,
    timeoutMs,
    inputSchema,
    execution
  };
}

function parseExecution(
  value: unknown,
  path: string,
  toolEnvironments: readonly AmdcEnvironment[]
): ToolDefinition["execution"] {
  const raw = asRecord(value, path);
  const type = parseEnum(raw.type, allowedExecutionTypes, `${path}.type`);

  if (type === "source_adapter") {
    return {
      type,
      operation: parseNonEmptyString(raw.operation, `${path}.operation`)
    };
  }

  if (type === "prometheus_http") {
    const baseUrlEnvironment = parseEnvironmentSourceMap(
      raw.baseUrlEnvironment,
      `${path}.baseUrlEnvironment`,
      toolEnvironments
    );
    const requestPath = parseNonEmptyString(raw.path, `${path}.path`);

    if (
      !requestPath.startsWith("/api/v1/") ||
      requestPath.includes("://") ||
      requestPath.includes("?") ||
      requestPath.includes("#") ||
      requestPath.includes("{{") ||
      requestPath.includes("}}")
    ) {
      throw new Error(`${path}.path must be a fixed Prometheus /api/v1/ path.`);
    }

    const rawQuery = asRecord(raw.query, `${path}.query`);
    const query: Record<string, string> = {};

    for (const [name, rawValue] of Object.entries(rawQuery)) {
      if (!templateVariableNamePattern.test(name)) {
        throw new Error(`${path}.query contains an invalid parameter name.`);
      }

      const value = parseNonEmptyString(rawValue, `${path}.query.${name}`);
      if (value.includes("{{") || value.includes("}}")) {
        throw new Error(`${path}.query values must be fixed strings.`);
      }
      query[name] = value;
    }

    return {
      type,
      baseUrlEnvironment,
      path: requestPath,
      query
    };
  }

  const command = parseNonEmptyString(raw.command, `${path}.command`);
  const rawEnvironment = asRecord(raw.environment, `${path}.environment`);
  const environment: Record<string, Record<AmdcEnvironment, string>> = {};

  for (const [logicalName, rawSources] of Object.entries(rawEnvironment)) {
    if (!templateVariableNamePattern.test(logicalName)) {
      throw new Error(`${path}.environment contains an invalid template variable name.`);
    }

    const sources = asRecord(rawSources, `${path}.environment.${logicalName}`);
    const parsedSources = {} as Record<AmdcEnvironment, string>;

    for (const toolEnvironment of toolEnvironments) {
      const sourceName = parseNonEmptyString(
        sources[toolEnvironment],
        `${path}.environment.${logicalName}.${toolEnvironment}`
      );

      if (!environmentVariableNamePattern.test(sourceName)) {
        throw new Error(
          `${path}.environment.${logicalName}.${toolEnvironment} must name a server environment variable.`
        );
      }

      parsedSources[toolEnvironment] = sourceName;
    }

    environment[logicalName] = parsedSources;
  }

  validateLocalShellTemplate(command, environment, path);

  return {
    type: "local_shell",
    command,
    environment
  };
}

function parseEnvironmentSourceMap(
  value: unknown,
  path: string,
  toolEnvironments: readonly AmdcEnvironment[]
): Record<AmdcEnvironment, string> {
  const rawSources = asRecord(value, path);
  const parsedSources = {} as Record<AmdcEnvironment, string>;

  for (const toolEnvironment of toolEnvironments) {
    const sourceName = parseNonEmptyString(
      rawSources[toolEnvironment],
      `${path}.${toolEnvironment}`
    );

    if (!environmentVariableNamePattern.test(sourceName)) {
      throw new Error(`${path}.${toolEnvironment} must name a server environment variable.`);
    }

    parsedSources[toolEnvironment] = sourceName;
  }

  return parsedSources;
}

function validateLocalShellTemplate(
  command: string,
  environment: Readonly<Record<string, unknown>>,
  path: string
): void {
  const referencePattern = /{{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*}}/g;
  const references = [...command.matchAll(referencePattern)].map((match) => match[1]);
  const unparsedTemplate = command.replace(referencePattern, "");

  if (unparsedTemplate.includes("{{") || unparsedTemplate.includes("}}")) {
    throw new Error(`${path}.command may reference only declared env.* variables.`);
  }

  for (const reference of references) {
    if (!(reference in environment)) {
      throw new Error(`${path}.command references an undeclared environment value.`);
    }
  }
}

function parseAccess(value: unknown, path: string): ToolDefinition["access"] {
  const raw = asRecord(value, path);

  if (raw.readOnly !== true) {
    throw new Error(`${path}.readOnly must be true.`);
  }

  if (raw.level !== 0) {
    throw new Error(`${path}.level must be 0 for the current AMDC P0 implementation.`);
  }

  return {
    level: 0,
    readOnly: true
  };
}

function parseInputSchema(value: unknown, path: string): JsonObjectSchema {
  const schema = asRecord(value, path);

  if (schema.type !== "object") {
    throw new Error(`${path}.type must be object.`);
  }

  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean"
  ) {
    throw new Error(`${path}.additionalProperties must be boolean when provided.`);
  }

  if (schema.properties !== undefined && !isRecord(schema.properties)) {
    throw new Error(`${path}.properties must be an object when provided.`);
  }

  if (schema.required !== undefined) {
    asArray(schema.required, `${path}.required`).forEach((required, index) => {
      parseNonEmptyString(required, `${path}.required[${index}]`);
    });
  }

  return schema as unknown as JsonObjectSchema;
}

function parsePluginName(value: unknown): PluginName {
  const name = parseEnum(value, allowedPluginNames, "plugin.name");
  return name as PluginName;
}

function parseEnum(
  value: unknown,
  allowed: ReadonlySet<string>,
  path: string
): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new Error(`${path} must be one of: ${[...allowed].join(", ")}.`);
  }

  return value;
}

function parseNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }

  return value.trim();
}

function parsePositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new Error(`${path} must be a positive integer.`);
  }

  return Number(value);
}

function asArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }

  return value;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }

  Object.freeze(value);

  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }

  return value;
}
