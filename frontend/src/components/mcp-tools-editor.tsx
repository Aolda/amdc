"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createMcpTool,
  deleteMcpTool,
  fetchMcpTools,
  updateMcpTool,
  type McpToolDefinition,
  type ToolLevel,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ToolRowProps {
  tool: McpToolDefinition;
  onLevel: (level: ToolLevel) => void;
  onHidden: (hidden: boolean) => void;
  onDescription: (description: string) => void;
  onDelete: () => void;
}

function ToolRow({
  tool,
  onLevel,
  onHidden,
  onDescription,
  onDelete,
}: ToolRowProps) {
  const [draft, setDraft] = useState(tool.description);
  useEffect(() => {
    setDraft(tool.description);
  }, [tool.description]);
  return (
    <tr className="border-t">
      <td className="p-2 font-mono">{tool.name}</td>
      <td className="p-2 font-mono text-muted-foreground">
        {tool.underlyingToolName ?? "—"}
      </td>
      <td className="p-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            if (draft !== tool.description) onDescription(draft);
          }}
          className="h-7 text-xs"
        />
      </td>
      <td className="p-2">
        <select
          value={tool.level}
          onChange={(e) => onLevel(Number(e.target.value) as ToolLevel)}
          className="rounded-md border bg-background px-2 py-1 text-xs"
        >
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
      </td>
      <td className="p-2">
        <input
          type="checkbox"
          checked={tool.hidden ?? false}
          onChange={(e) => onHidden(e.target.checked)}
        />
      </td>
      <td className="p-2 text-right">
        <Button variant="destructive" size="sm" onClick={onDelete}>
          Delete
        </Button>
      </td>
    </tr>
  );
}

interface Props {
  mcpName: string;
  mcpKind: string;
  defaultLevel: ToolLevel;
}

interface NewToolDraft {
  wrapperName: string;
  underlyingToolName: string;
  description: string;
  level: ToolLevel;
  paramValues: Record<string, string>;
  rawJson: string;
}

const emptyDraft = (defaultLevel: ToolLevel): NewToolDraft => ({
  wrapperName: "",
  underlyingToolName: "",
  description: "",
  level: defaultLevel,
  paramValues: {},
  rawJson: "",
});

interface SchemaProperty {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  enumValues?: unknown[];
}

function normalizeSchemaType(rawType: unknown): string {
  if (typeof rawType === "string") return rawType;
  if (Array.isArray(rawType)) {
    const first = rawType.find((t) => typeof t === "string");
    return typeof first === "string" ? first : "string";
  }
  return "string";
}

function extractSchemaProperties(
  schema: Record<string, unknown> | undefined,
): SchemaProperty[] {
  if (!schema) return [];
  const properties = schema.properties;
  if (typeof properties !== "object" || properties === null) return [];
  const required = Array.isArray(schema.required)
    ? (schema.required as unknown[]).filter(
        (v): v is string => typeof v === "string",
      )
    : [];
  return Object.entries(properties).map(([name, raw]) => {
    const def = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    const type = normalizeSchemaType(def.type);
    return {
      name,
      type,
      description:
        typeof def.description === "string" ? def.description : undefined,
      required: required.includes(name),
      enumValues: Array.isArray(def.enum) ? (def.enum as unknown[]) : undefined,
    };
  });
}

function coerceValue(
  type: string,
  raw: string,
): { value: unknown; error: string | null } {
  if (type === "number" || type === "integer") {
    const n = Number(raw);
    if (Number.isNaN(n)) return { value: null, error: "not a number" };
    return { value: n, error: null };
  }
  if (type === "boolean") {
    if (raw === "true") return { value: true, error: null };
    if (raw === "false") return { value: false, error: null };
    return { value: null, error: "must be true or false" };
  }
  if (type === "object" || type === "array") {
    try {
      return { value: JSON.parse(raw) as unknown, error: null };
    } catch (err) {
      return {
        value: null,
        error: err instanceof Error ? err.message : "invalid JSON",
      };
    }
  }
  return { value: raw, error: null };
}

function buildFixedParams(
  draft: NewToolDraft,
  properties: SchemaProperty[],
): { value: Record<string, unknown>; error: string | null } {
  const out: Record<string, unknown> = {};
  for (const prop of properties) {
    const raw = draft.paramValues[prop.name];
    if (raw === undefined || raw === "") continue;
    const { value, error } = coerceValue(prop.type, raw);
    if (error) return { value: out, error: `${prop.name}: ${error}` };
    out[prop.name] = value;
  }
  const trimmed = draft.rawJson.trim();
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return { value: out, error: "extra JSON must be an object" };
      }
      Object.assign(out, parsed);
    } catch (err) {
      return {
        value: out,
        error: `extra JSON: ${err instanceof Error ? err.message : "invalid"}`,
      };
    }
  }
  return { value: out, error: null };
}

function ParamFieldInput({
  prop,
  value,
  onChange,
}: {
  prop: SchemaProperty;
  value: string;
  onChange: (value: string) => void;
}) {
  if (prop.enumValues) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-2 py-1 text-xs"
      >
        <option value="">— leave unset —</option>
        {prop.enumValues.map((v) => (
          <option key={String(v)} value={String(v)}>
            {String(v)}
          </option>
        ))}
      </select>
    );
  }
  if (prop.type === "boolean") {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border bg-background px-2 py-1 text-xs"
      >
        <option value="">— leave unset —</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (prop.type === "object" || prop.type === "array") {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs"
        placeholder={prop.type === "array" ? "[]" : "{}"}
      />
    );
  }
  const inputType =
    prop.type === "number" || prop.type === "integer" ? "number" : "text";
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`${prop.type} (leave blank to not pin)`}
      className="h-7 text-xs"
      type={inputType}
    />
  );
}

function ParamField({
  prop,
  value,
  onChange,
}: {
  prop: SchemaProperty;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        <span className="font-mono">{prop.name}</span>
        <span className="ml-2 text-muted-foreground">
          {prop.type}
          {prop.required ? " · required" : " · optional"}
        </span>
      </Label>
      {prop.description && (
        <p className="text-xs text-muted-foreground">{prop.description}</p>
      )}
      <ParamFieldInput prop={prop} value={value} onChange={onChange} />
    </div>
  );
}

export function McpToolsEditor({ mcpName, mcpKind, defaultLevel }: Props) {
  const supportsUnderlying = mcpKind === "upstream" || mcpKind === "native";
  const [tools, setTools] = useState<McpToolDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NewToolDraft>(emptyDraft(defaultLevel));
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    fetchMcpTools(mcpName)
      .then((rows) => {
        setTools(rows);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "failed to load");
      })
      .finally(() => setLoading(false));
  }, [mcpName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleLevel(toolName: string, level: ToolLevel) {
    const updated = await updateMcpTool(mcpName, toolName, { level });
    setTools((prev) =>
      prev.map((t) => (t.name === toolName ? { ...t, ...updated } : t)),
    );
  }

  async function handleHidden(toolName: string, hidden: boolean) {
    const updated = await updateMcpTool(mcpName, toolName, { hidden });
    setTools((prev) =>
      prev.map((t) => (t.name === toolName ? { ...t, ...updated } : t)),
    );
  }

  async function handleDescription(toolName: string, description: string) {
    const updated = await updateMcpTool(mcpName, toolName, { description });
    setTools((prev) =>
      prev.map((t) => (t.name === toolName ? { ...t, ...updated } : t)),
    );
  }

  async function handleDelete(toolName: string) {
    if (!confirm(`Delete wrapper '${toolName}'?`)) return;
    await deleteMcpTool(mcpName, toolName);
    refresh();
  }

  const underlyingOptions = (() => {
    if (!supportsUnderlying) return [] as string[];
    const set = new Set<string>();
    for (const tool of tools) {
      if (tool.underlyingToolName) set.add(tool.underlyingToolName);
      if (tool.kind === "mcp" && tool.wrapperName) set.add(tool.wrapperName);
    }
    return Array.from(set).sort();
  })();

  const selectedUnderlying = draft.underlyingToolName
    ? (tools.find(
        (t) =>
          t.wrapperName === draft.underlyingToolName ||
          t.name === draft.underlyingToolName,
      ) ?? null)
    : null;
  const underlyingSchemaProps = extractSchemaProperties(
    selectedUnderlying?.inputSchema,
  );

  async function handleCreate() {
    setError(null);
    if (!draft.wrapperName.trim()) {
      setError("wrapperName is required");
      return;
    }
    if (supportsUnderlying && !draft.underlyingToolName) {
      setError("pick an underlying tool to wrap");
      return;
    }
    const params = buildFixedParams(draft, underlyingSchemaProps);
    if (params.error) {
      setError(`fixedParams: ${params.error}`);
      return;
    }
    setCreating(true);
    try {
      await createMcpTool(mcpName, {
        wrapperName: draft.wrapperName.trim(),
        underlyingToolName: draft.underlyingToolName.trim() || null,
        description: draft.description,
        level: draft.level,
        config:
          Object.keys(params.value).length > 0
            ? { fixedParams: params.value }
            : {},
      });
      setDraft(emptyDraft(defaultLevel));
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Tools</h2>
        <p className="text-xs text-muted-foreground">
          Each row is a wrapper. Upstream tools appear automatically as
          passthrough wrappers — customize description, level, hide them, or add
          new wrappers that point to the same underlying tool with different
          fixedParams.
        </p>
      </div>

      {loading && <p className="text-xs text-muted-foreground">Loading...</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {!loading && tools.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="p-2">wrapperName</th>
                <th className="p-2">underlying</th>
                <th className="p-2">description</th>
                <th className="p-2">level</th>
                <th className="p-2">hidden</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <ToolRow
                  key={tool.name}
                  tool={tool}
                  onLevel={(level) => void handleLevel(tool.name, level)}
                  onHidden={(hidden) => void handleHidden(tool.name, hidden)}
                  onDescription={(desc) =>
                    void handleDescription(tool.name, desc)
                  }
                  onDelete={() => void handleDelete(tool.name)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-md border p-3">
        <h3 className="mb-2 text-sm font-semibold">Add wrapper</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>wrapperName</Label>
            <Input
              value={draft.wrapperName}
              onChange={(e) =>
                setDraft((d) => ({ ...d, wrapperName: e.target.value }))
              }
              placeholder="cpu_usage"
            />
          </div>
          {supportsUnderlying && (
            <div className="space-y-1">
              <Label>underlying tool (to wrap)</Label>
              <select
                value={draft.underlyingToolName}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    underlyingToolName: e.target.value,
                  }))
                }
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— select a tool to wrap —</option>
                {underlyingOptions.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1 col-span-2">
            <Label>description</Label>
            <Input
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label>level</Label>
            <select
              value={draft.level}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  level: Number(e.target.value) as ToolLevel,
                }))
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
          <div className="col-span-2 space-y-2 rounded-md border bg-muted/20 p-3">
            <div className="flex items-baseline justify-between">
              <Label className="text-sm font-semibold">
                fixedParams (pin values on the wrapped tool)
              </Label>
              {selectedUnderlying?.description && (
                <span className="text-xs text-muted-foreground">
                  {selectedUnderlying.description}
                </span>
              )}
            </div>
            {!selectedUnderlying && (
              <p className="text-xs text-muted-foreground">
                Pick an underlying tool above to see its parameters.
              </p>
            )}
            {selectedUnderlying && underlyingSchemaProps.length === 0 && (
              <p className="text-xs text-muted-foreground">
                The selected tool exposes no inputSchema properties. Use the raw
                JSON override below if you need to pin something anyway.
              </p>
            )}
            {underlyingSchemaProps.map((prop) => {
              const current = draft.paramValues[prop.name] ?? "";
              const setField = (value: string) =>
                setDraft((d) => ({
                  ...d,
                  paramValues: { ...d.paramValues, [prop.name]: value },
                }));
              return (
                <ParamField
                  key={prop.name}
                  prop={prop}
                  value={current}
                  onChange={setField}
                />
              );
            })}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                extra JSON (optional, merged on top of the above)
              </Label>
              <textarea
                value={draft.rawJson}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, rawJson: e.target.value }))
                }
                rows={2}
                className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs"
                placeholder='{ "unusual_field": "..." }'
              />
            </div>
          </div>
        </div>
        <div className="mt-3">
          <Button onClick={() => void handleCreate()} disabled={creating}>
            {creating ? "Creating..." : "Add wrapper"}
          </Button>
        </div>
      </div>
    </div>
  );
}
