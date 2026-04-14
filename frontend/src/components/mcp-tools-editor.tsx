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

interface Props {
  mcpName: string;
  defaultLevel: ToolLevel;
}

interface NewToolDraft {
  wrapperName: string;
  underlyingToolName: string;
  description: string;
  level: ToolLevel;
  fixedParams: string;
}

const emptyDraft = (defaultLevel: ToolLevel): NewToolDraft => ({
  wrapperName: "",
  underlyingToolName: "",
  description: "",
  level: defaultLevel,
  fixedParams: "",
});

function parseFixedParams(raw: string): {
  value: Record<string, unknown> | undefined;
  error: string | null;
} {
  const trimmed = raw.trim();
  if (trimmed === "") return { value: undefined, error: null };
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { value: undefined, error: "fixedParams must be a JSON object" };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch (err) {
    return {
      value: undefined,
      error: err instanceof Error ? err.message : "invalid JSON",
    };
  }
}

export function McpToolsEditor({ mcpName, defaultLevel }: Props) {
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

  async function handleCreate() {
    setError(null);
    const parsed = parseFixedParams(draft.fixedParams);
    if (parsed.error) {
      setError(`fixedParams: ${parsed.error}`);
      return;
    }
    if (!draft.wrapperName.trim()) {
      setError("wrapperName is required");
      return;
    }
    setCreating(true);
    try {
      await createMcpTool(mcpName, {
        wrapperName: draft.wrapperName.trim(),
        underlyingToolName: draft.underlyingToolName.trim() || null,
        description: draft.description,
        level: draft.level,
        config: parsed.value ? { fixedParams: parsed.value } : {},
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
                <tr key={tool.name} className="border-t">
                  <td className="p-2 font-mono">{tool.name}</td>
                  <td className="p-2 font-mono text-muted-foreground">
                    {tool.underlyingToolName ?? "—"}
                  </td>
                  <td className="p-2">
                    <Input
                      defaultValue={tool.description}
                      onBlur={(e) => {
                        if (e.target.value !== tool.description) {
                          void handleDescription(tool.name, e.target.value);
                        }
                      }}
                      className="h-7 text-xs"
                    />
                  </td>
                  <td className="p-2">
                    <select
                      value={tool.level}
                      onChange={(e) =>
                        void handleLevel(
                          tool.name,
                          Number(e.target.value) as ToolLevel,
                        )
                      }
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
                      onChange={(e) =>
                        void handleHidden(tool.name, e.target.checked)
                      }
                    />
                  </td>
                  <td className="p-2 text-right">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void handleDelete(tool.name)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
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
          <div className="space-y-1">
            <Label>underlyingToolName</Label>
            <Input
              value={draft.underlyingToolName}
              onChange={(e) =>
                setDraft((d) => ({ ...d, underlyingToolName: e.target.value }))
              }
              placeholder="query_prometheus (leave blank for cli/script)"
            />
          </div>
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
          <div className="space-y-1 col-span-2">
            <Label>fixedParams (JSON object, optional)</Label>
            <textarea
              value={draft.fixedParams}
              onChange={(e) =>
                setDraft((d) => ({ ...d, fixedParams: e.target.value }))
              }
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 font-mono text-xs"
              placeholder='{ "query": "rate(cpu[5m])" }'
            />
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
