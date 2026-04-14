"use client";

import { useState } from "react";
import {
  type CreateMcpInput,
  type Mcp,
  type McpKind,
  type ToolLevel,
  type UpdateMcpInput,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  initialValues?: Mcp;
  onSubmit: (input: CreateMcpInput | UpdateMcpInput) => Promise<void>;
  submitLabel: string;
  isEdit?: boolean;
}

export function McpForm({
  initialValues,
  onSubmit,
  submitLabel,
  isEdit,
}: Props) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [kind, setKind] = useState<McpKind>(
    (initialValues?.kind as McpKind | undefined) ?? "upstream",
  );
  const [description, setDescription] = useState(
    initialValues?.description ?? "",
  );
  const [defaultLevel, setDefaultLevel] = useState<ToolLevel>(
    initialValues?.defaultLevel ?? 3,
  );
  const [upstreamUrl, setUpstreamUrl] = useState(
    initialValues?.upstreamUrl ?? "",
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (isEdit) {
        await onSubmit({
          description,
          defaultLevel,
          ...(kind === "upstream" ? { upstreamUrl } : {}),
        });
      } else {
        await onSubmit({
          name,
          kind,
          description,
          defaultLevel,
          ...(kind === "upstream" ? { upstreamUrl } : {}),
        });
      }
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
          placeholder="e.g. grafana"
          required={!isEdit}
          disabled={isEdit}
          pattern="^[a-zA-Z0-9_-]+$"
          title="영문, 숫자, 하이픈(-), 밑줄(_)만 사용 가능합니다"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="kind">Kind</Label>
        <select
          id="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as McpKind)}
          disabled={isEdit}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60"
        >
          <option value="upstream">
            upstream — proxies a remote MCP server
          </option>
          <option value="cli">
            cli — AMDC-local wrappers around shell commands
          </option>
        </select>
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

      {kind === "upstream" && (
        <div className="space-y-2">
          <Label htmlFor="upstreamUrl">Upstream MCP URL</Label>
          <Input
            id="upstreamUrl"
            value={upstreamUrl}
            onChange={(e) => setUpstreamUrl(e.target.value)}
            placeholder="https://example.com/mcp"
            required
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="defaultLevel">Default level</Label>
        <select
          id="defaultLevel"
          value={defaultLevel}
          onChange={(e) => setDefaultLevel(Number(e.target.value) as ToolLevel)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="1">1 — high risk (always require approval)</option>
          <option value="2">2 — medium risk (approval to enable)</option>
          <option value="3">3 — low risk (auto allow)</option>
        </select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={loading}>
        {loading ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
