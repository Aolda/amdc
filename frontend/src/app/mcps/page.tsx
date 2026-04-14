"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  fetchMcps,
  fetchMcpTools,
  updateMcpToolLevel,
  deleteMcp,
  type Mcp,
  type McpToolDefinition,
  type ToolLevel,
} from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface McpRowProps {
  mcp: Mcp;
  expanded: boolean;
  tools: McpToolDefinition[] | undefined;
  onToggleExpand: () => void;
  onDelete: () => void;
  onToolLevelChange: (toolName: string, level: ToolLevel) => void;
}

function McpRow({
  mcp,
  expanded,
  tools,
  onToggleExpand,
  onDelete,
  onToolLevelChange,
}: McpRowProps) {
  const isEditable = mcp.kind === "upstream" || mcp.kind === "cli";
  return (
    <>
      <TableRow>
        <TableCell>
          <button
            type="button"
            onClick={onToggleExpand}
            className="mr-2 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? "▾" : "▸"}
          </button>
          <span className="font-medium">{mcp.name}</span>
          {mcp.description && (
            <p className="text-xs text-muted-foreground">{mcp.description}</p>
          )}
        </TableCell>
        <TableCell>
          <span className="text-xs text-muted-foreground">{mcp.kind}</span>
        </TableCell>
        <TableCell>
          <span className="text-xs text-muted-foreground">
            {mcp.upstreamUrl ?? "—"}
          </span>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-2">
            {isEditable ? (
              <>
                <Link
                  href={`/mcps/${encodeURIComponent(mcp.name)}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Edit
                </Link>
                <Button variant="destructive" size="sm" onClick={onDelete}>
                  Delete
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">read-only</span>
            )}
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={4} className="bg-muted/30">
            {tools === undefined && (
              <p className="text-xs text-muted-foreground">loading tools...</p>
            )}
            {tools && tools.length === 0 && (
              <p className="text-xs text-muted-foreground">
                (no tools exposed)
              </p>
            )}
            {tools && tools.length > 0 && (
              <div className="space-y-1 pl-6">
                {tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{tool.name}</span>
                      {tool.description && (
                        <span className="text-muted-foreground">
                          {tool.description}
                        </span>
                      )}
                    </div>
                    <span className="flex items-center gap-1">
                      <span className="text-muted-foreground">
                        default level
                      </span>
                      <select
                        value={String(tool.level)}
                        onChange={(e) =>
                          onToolLevelChange(
                            tool.name,
                            Number(e.target.value) as ToolLevel,
                          )
                        }
                        className="rounded-md border bg-background px-2 py-1"
                      >
                        <option value="1">1</option>
                        <option value="2">2</option>
                        <option value="3">3</option>
                      </select>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export default function McpsPage() {
  const [mcps, setMcps] = useState<Mcp[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [toolsByName, setToolsByName] = useState<
    Record<string, McpToolDefinition[]>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    setMcps(await fetchMcps());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function ensureToolsLoaded(name: string) {
    if (toolsByName[name]) return;
    fetchMcpTools(name)
      .then((tools) => {
        setToolsByName((prev) => ({ ...prev, [name]: tools }));
      })
      .catch(() => {
        setToolsByName((prev) => ({ ...prev, [name]: [] }));
      });
  }

  function toggleExpand(name: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        ensureToolsLoaded(name);
      }
      return next;
    });
  }

  async function handleDelete(name: string) {
    if (!confirm(`Delete MCP '${name}'?`)) return;
    try {
      await deleteMcp(name);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  async function handleToolLevelChange(
    mcpName: string,
    toolName: string,
    level: ToolLevel,
  ) {
    try {
      const updated = await updateMcpToolLevel(mcpName, toolName, level);
      setToolsByName((prev) => {
        const list = prev[mcpName] ?? [];
        return {
          ...prev,
          [mcpName]: list.map((t) =>
            t.name === toolName ? { ...t, level: updated.level } : t,
          ),
        };
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Update failed");
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCPs</h1>
          <p className="text-sm text-muted-foreground">
            Tool providers wrapped by proxy_mcp. Native MCPs are read-only;
            upstream MCPs are user-configurable. Expand a row to set each tool's
            default level (agents can override with a custom level).
          </p>
        </div>
        <Link href="/mcps/new" className={buttonVariants()}>
          + New MCP
        </Link>
      </div>

      <div className="mt-6">
        {loading && (
          <p className="py-8 text-center text-muted-foreground">Loading...</p>
        )}
        {!loading && mcps.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">
            No MCPs registered.
          </p>
        )}
        {!loading && mcps.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Upstream URL</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mcps.map((m) => (
                <McpRow
                  key={m.name}
                  mcp={m}
                  expanded={expanded.has(m.name)}
                  tools={toolsByName[m.name]}
                  onToggleExpand={() => toggleExpand(m.name)}
                  onDelete={() => handleDelete(m.name)}
                  onToolLevelChange={(toolName, level) =>
                    handleToolLevelChange(m.name, toolName, level)
                  }
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
