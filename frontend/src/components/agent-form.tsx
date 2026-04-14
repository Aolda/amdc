"use client";

import { useEffect, useState } from "react";
import {
  fetchSkills,
  fetchAgents,
  fetchMcps,
  fetchMcpTools,
  type AgentInput,
  type AgentMcpLink,
  type Skill,
  type Agent,
  type Mcp,
  type McpToolDefinition,
  type ToolLevel,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initialValues?: Partial<AgentInput> & { id?: string };
  onSubmit: (input: AgentInput) => Promise<void>;
  submitLabel: string;
}

function effectiveLevelFor(
  link: AgentMcpLink | undefined,
  toolDefault: ToolLevel,
  toolName: string,
): ToolLevel {
  if (!link) return toolDefault;
  const toolOverride = link.toolOverrides.find((t) => t.toolName === toolName);
  if (toolOverride) return toolOverride.level;
  if (link.levelOverride !== null) return link.levelOverride;
  return toolDefault;
}

interface ToolRowProps {
  tool: McpToolDefinition;
  link: AgentMcpLink | undefined;
  onChange: (value: string) => void;
}

function ToolRow({ tool, link, onChange }: ToolRowProps) {
  const override = link?.toolOverrides.find((t) => t.toolName === tool.name);
  const effective = effectiveLevelFor(link, tool.level, tool.name);
  const overridden = effective !== tool.level;
  const dropdownValue = override ? String(override.level) : "default";
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-2">
        <span className={overridden ? "font-semibold text-amber-600" : ""}>
          {tool.name}
        </span>
        <span className="text-muted-foreground">
          default {tool.level}
          {overridden ? ` → custom ${effective}` : ""}
        </span>
      </div>
      <select
        value={dropdownValue}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-md border bg-background px-2 py-1 text-xs ${
          override ? "border-amber-500 font-semibold" : ""
        }`}
      >
        <option value="default">default</option>
        <option value="1">{`1${tool.level === 1 ? " (default)" : ""}`}</option>
        <option value="2">{`2${tool.level === 2 ? " (default)" : ""}`}</option>
        <option value="3">{`3${tool.level === 3 ? " (default)" : ""}`}</option>
      </select>
    </div>
  );
}

export function AgentForm({ initialValues, onSubmit, submitLabel }: Props) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(
    initialValues?.description ?? "",
  );
  const [body, setBody] = useState(initialValues?.body ?? "");
  const [skillIds, setSkillIds] = useState<string[]>(
    initialValues?.skillIds ?? [],
  );
  const [subAgentIds, setSubAgentIds] = useState<string[]>(
    initialValues?.subAgentIds ?? [],
  );
  const [mcpLinks, setMcpLinks] = useState<AgentMcpLink[]>(
    initialValues?.mcps ?? [],
  );
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [availableMcps, setAvailableMcps] = useState<Mcp[]>([]);
  const [mcpToolsByName, setMcpToolsByName] = useState<
    Record<string, McpToolDefinition[]>
  >({});
  const [expandedMcps, setExpandedMcps] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSkills().then(setAvailableSkills);
    fetchMcps().then(setAvailableMcps);
    fetchAgents().then((agents) => {
      setAvailableAgents(agents.filter((a) => a.id !== initialValues?.id));
    });
  }, [initialValues?.id]);

  function ensureToolsLoaded(mcpName: string) {
    if (mcpToolsByName[mcpName]) return;
    fetchMcpTools(mcpName)
      .then((tools) => {
        setMcpToolsByName((prev) => ({ ...prev, [mcpName]: tools }));
      })
      .catch(() => {
        setMcpToolsByName((prev) => ({ ...prev, [mcpName]: [] }));
      });
  }

  function toggleSkill(id: string) {
    setSkillIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleSubAgent(id: string) {
    setSubAgentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function isMcpSelected(mcpName: string): boolean {
    return mcpLinks.some((link) => link.name === mcpName);
  }

  function toggleMcp(mcpName: string) {
    setMcpLinks((prev) =>
      prev.some((link) => link.name === mcpName)
        ? prev.filter((link) => link.name !== mcpName)
        : [...prev, { name: mcpName, levelOverride: null, toolOverrides: [] }],
    );
    ensureToolsLoaded(mcpName);
  }

  function toggleExpand(mcpName: string) {
    setExpandedMcps((prev) => {
      const next = new Set(prev);
      if (next.has(mcpName)) {
        next.delete(mcpName);
      } else {
        next.add(mcpName);
        ensureToolsLoaded(mcpName);
      }
      return next;
    });
  }

  function setMcpBulkLevel(mcpName: string, value: string) {
    const levelOverride =
      value === "default" ? null : (Number(value) as ToolLevel);
    setMcpLinks((prev) =>
      prev.map((link) =>
        link.name === mcpName ? { ...link, levelOverride } : link,
      ),
    );
  }

  function applyToolLevel(
    link: AgentMcpLink,
    toolName: string,
    value: string,
  ): AgentMcpLink {
    const others = link.toolOverrides.filter((t) => t.toolName !== toolName);
    if (value === "default") return { ...link, toolOverrides: others };
    return {
      ...link,
      toolOverrides: [
        ...others,
        { toolName, level: Number(value) as ToolLevel },
      ],
    };
  }

  function setToolLevel(mcpName: string, toolName: string, value: string) {
    setMcpLinks((prev) =>
      prev.map((link) =>
        link.name === mcpName ? applyToolLevel(link, toolName, value) : link,
      ),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onSubmit({
        name,
        description,
        body,
        skillIds,
        subAgentIds,
        mcps: mcpLinks,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ops-agent"
          required
          pattern="^[a-zA-Z0-9_-]+$"
          title="영문, 숫자, 하이픈(-), 밑줄(_)만 사용 가능합니다"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="short summary"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="body">agent.md (markdown)</Label>
        <textarea
          id="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          required
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label>Skills</Label>
        {availableSkills.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No skills available. Create one in the Skills tab first.
          </p>
        ) : (
          <div className="space-y-1 rounded-md border p-3">
            {availableSkills.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={skillIds.includes(s.id)}
                  onChange={() => toggleSkill(s.id)}
                />
                <span className="font-medium">{s.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>Sub-Agents</Label>
        {availableAgents.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No other agents available.
          </p>
        ) : (
          <div className="space-y-1 rounded-md border p-3">
            {availableAgents.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={subAgentIds.includes(a.id)}
                  onChange={() => toggleSubAgent(a.id)}
                />
                <span className="font-medium">{a.name}</span>
                {a.description && (
                  <span className="text-xs text-muted-foreground">
                    {a.description}
                  </span>
                )}
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>MCPs</Label>
        {availableMcps.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No MCPs registered. Add one in the MCPs tab.
          </p>
        ) : (
          <div className="space-y-2 rounded-md border p-3">
            {availableMcps.map((m) => {
              const link = mcpLinks.find((l) => l.name === m.name);
              const selected = isMcpSelected(m.name);
              const expanded = expandedMcps.has(m.name);
              const tools = mcpToolsByName[m.name];
              const bulkValue =
                link?.levelOverride === null || link === undefined
                  ? "default"
                  : String(link.levelOverride);
              const bulkOverridden =
                link?.levelOverride !== null && link !== undefined;
              return (
                <div
                  key={m.name}
                  className="rounded-md border bg-background p-2"
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <label className="flex flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleMcp(m.name)}
                      />
                      <span className="font-medium">{m.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.kind} · default level {m.defaultLevel}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => toggleExpand(m.name)}
                      disabled={!selected}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      {expanded ? "▾ tools" : "▸ tools"}
                    </button>
                    <span className="flex items-center gap-1 text-xs">
                      <span className="text-muted-foreground">
                        custom level (all tools):
                      </span>
                      <select
                        value={bulkValue}
                        onChange={(e) =>
                          setMcpBulkLevel(m.name, e.target.value)
                        }
                        disabled={!selected}
                        className={`rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-50 ${
                          bulkOverridden ? "border-amber-500 font-semibold" : ""
                        }`}
                      >
                        <option value="default">default</option>
                        <option value="1">{`1${m.defaultLevel === 1 ? " (default)" : ""}`}</option>
                        <option value="2">{`2${m.defaultLevel === 2 ? " (default)" : ""}`}</option>
                        <option value="3">{`3${m.defaultLevel === 3 ? " (default)" : ""}`}</option>
                      </select>
                    </span>
                  </div>

                  {selected && expanded && (
                    <div className="mt-2 space-y-1 border-t pt-2 pl-6">
                      {tools === undefined && (
                        <p className="text-xs text-muted-foreground">
                          loading tools...
                        </p>
                      )}
                      {tools && tools.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          (no tools exposed)
                        </p>
                      )}
                      {tools?.map((tool) => (
                        <ToolRow
                          key={tool.name}
                          tool={tool}
                          link={link}
                          onChange={(value) =>
                            setToolLevel(m.name, tool.name, value)
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={loading}>
        {loading ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
