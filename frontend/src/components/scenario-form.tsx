"use client";

import { useState } from "react";
import type { CreateScenarioInput } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Props {
  initialValues?: Partial<CreateScenarioInput>;
  onSubmit: (input: CreateScenarioInput) => Promise<void>;
  submitLabel: string;
}

export function ScenarioForm({ initialValues, onSubmit, submitLabel }: Props) {
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(
    initialValues?.description ?? "",
  );
  const [promptTemplate, setPromptTemplate] = useState(
    initialValues?.promptTemplate ?? "",
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onSubmit({ name, description, promptTemplate });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. mysql-down"
          required
          pattern="^[a-zA-Z0-9_-]+$"
          title="영문, 숫자, 하이픈(-), 밑줄(_)만 사용 가능합니다"
        />
        <p className="text-xs text-muted-foreground">
          Grafana Alert Rule의 label에 사용됩니다: scenario = {name || "..."}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. CPU 임계치 초과 시 slow query 분석"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prompt Template</CardTitle>
          <CardDescription>
            Grafana alert 데이터를 변수로 사용할 수 있습니다.
            {"{{alertname}}"}, {"{{instance}}"}, {"{{value}}"} 등. 전체 alert
            데이터는 자동으로 첨부됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            id="promptTemplate"
            value={promptTemplate}
            onChange={(e) => setPromptTemplate(e.target.value)}
            placeholder="[{{severity}}] {{instance}}에서 문제가 발생했습니다. 분석하세요."
            required
            rows={5}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={loading}>
        {loading ? "Saving..." : submitLabel}
      </Button>
    </form>
  );
}
