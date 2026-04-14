"use client";

import { useEffect, useState } from "react";
import {
  fetchSkills,
  fetchAgents,
  fetchPlugins,
  type AgentInput,
  type AgentPluginLink,
  type Skill,
  type Agent,
  type Plugin,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initialValues?: Partial<AgentInput> & { id?: string };
  onSubmit: (input: AgentInput) => Promise<void>;
  submitLabel: string;
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
  const [pluginLinks, setPluginLinks] = useState<AgentPluginLink[]>(
    initialValues?.plugins ?? [],
  );
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [availableAgents, setAvailableAgents] = useState<Agent[]>([]);
  const [availablePlugins, setAvailablePlugins] = useState<Plugin[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSkills().then(setAvailableSkills);
    fetchPlugins().then(setAvailablePlugins);
    fetchAgents().then((agents) => {
      setAvailableAgents(agents.filter((a) => a.id !== initialValues?.id));
    });
  }, [initialValues?.id]);

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

  function isPluginSelected(name: string): boolean {
    return pluginLinks.some((link) => link.name === name);
  }

  function togglePlugin(name: string) {
    setPluginLinks((prev) =>
      prev.some((link) => link.name === name)
        ? prev.filter((link) => link.name !== name)
        : [...prev, { name, levelOverride: null }],
    );
  }

  function setPluginLevel(name: string, value: string) {
    const levelOverride =
      value === "default" ? null : (Number(value) as 1 | 2 | 3);
    setPluginLinks((prev) =>
      prev.map((link) =>
        link.name === name ? { ...link, levelOverride } : link,
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
        plugins: pluginLinks,
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
        <Label>Plugins</Label>
        {availablePlugins.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No plugins registered.
          </p>
        ) : (
          <div className="space-y-1 rounded-md border p-3">
            {availablePlugins.map((p) => {
              const selected = isPluginSelected(p.name);
              const current =
                pluginLinks.find((link) => link.name === p.name)
                  ?.levelOverride ?? null;
              return (
                <div
                  key={p.name}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <label className="flex flex-1 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => togglePlugin(p.name)}
                    />
                    <span className="font-medium">{p.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {p.kind} · default level {p.defaultLevel}
                    </span>
                  </label>
                  <select
                    value={current === null ? "default" : String(current)}
                    onChange={(e) => setPluginLevel(p.name, e.target.value)}
                    disabled={!selected}
                    className="rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-50"
                  >
                    <option value="default">default</option>
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
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
