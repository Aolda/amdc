"use client";

import { useEffect, useState } from "react";
import {
  fetchWebhookAuthKey,
  regenerateWebhookAuthKey,
  fetchAgentSystemPrompt,
  updateAgentSystemPrompt,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}

export default function SettingsPage() {
  const [authKey, setAuthKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [savedPrompt, setSavedPrompt] = useState("");
  const [savingPrompt, setSavingPrompt] = useState(false);

  useEffect(() => {
    Promise.all([fetchWebhookAuthKey(), fetchAgentSystemPrompt()]).then(
      ([key, prompt]) => {
        setAuthKey(key);
        setSystemPrompt(prompt);
        setSavedPrompt(prompt);
        setLoading(false);
      },
    );
  }, []);

  async function handleSavePrompt() {
    setSavingPrompt(true);
    try {
      await updateAgentSystemPrompt(systemPrompt);
      setSavedPrompt(systemPrompt);
    } finally {
      setSavingPrompt(false);
    }
  }

  async function handleRegenerate() {
    if (
      !confirm(
        "Auth Key를 재생성하면 기존 Grafana Contact Point의 인증이 모두 실패합니다. 계속하시겠습니까?",
      )
    )
      return;
    const newKey = await regenerateWebhookAuthKey();
    setAuthKey(newKey);
    setShowKey(true);
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Webhook Auth Key</CardTitle>
          <CardDescription>
            Grafana Contact Point의 Authorization 헤더에 사용되는 전역 인증
            키입니다. 모든 시나리오에서 공유됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="block flex-1 rounded bg-muted px-3 py-2 text-sm font-mono">
              {showKey ? authKey : "sk-••••••••••••••••••••••••••••••••"}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowKey(!showKey)}
            >
              {showKey ? "Hide" : "Show"}
            </Button>
          </div>
          <div className="flex gap-2">
            <CopyButton text={authKey} />
            <Button variant="destructive" size="sm" onClick={handleRegenerate}>
              Regenerate
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Grafana Contact Point 설정 시{" "}
            <code className="rounded bg-muted px-1">Bearer {"<auth-key>"}</code>{" "}
            형식으로 Authorization Header에 입력하세요.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Agent System Prompt</CardTitle>
          <CardDescription>
            모든 agent 호출 시 공통으로 주입되는 system prompt입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={10}
            className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
            placeholder="You are an SRE assistant..."
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={handleSavePrompt}
              disabled={savingPrompt || systemPrompt === savedPrompt}
            >
              {savingPrompt ? "Saving..." : "Save"}
            </Button>
            {systemPrompt === savedPrompt && savedPrompt && (
              <span className="text-xs text-muted-foreground">Saved</span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
