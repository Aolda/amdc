"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  fetchScenario,
  fetchInvocations,
  type Scenario,
  type Invocation,
} from "@/lib/api";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy}>
      {copied ? "Copied!" : `Copy ${label}`}
    </Button>
  );
}

export default function ScenarioDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [invocations, setInvocations] = useState<Invocation[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchScenario(id).then(setScenario);
    fetchInvocations(id).then(setInvocations);
  }, [id]);

  if (!scenario) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  const webhookUrl = `${window.location.origin}/api/webhooks`;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={() => router.push("/scenarios")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          &larr; Back
        </button>
        <Link
          href={`/scenarios/${scenario.id}/edit`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Edit
        </Link>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{scenario.name}</h1>
        <Badge variant={scenario.enabled ? "default" : "secondary"}>
          {scenario.enabled ? "Active" : "Disabled"}
        </Badge>
      </div>
      {scenario.description && (
        <p className="mb-6 text-muted-foreground">{scenario.description}</p>
      )}

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhook</CardTitle>
            <CardDescription>
              Grafana Alert Rule에 아래 label을 추가하세요
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Webhook URL (공통)
              </p>
              <code className="block rounded bg-muted px-3 py-2 text-sm">
                {webhookUrl}
              </code>
              <CopyButton text={webhookUrl} label="URL" />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Scenario Label (Alert Rule에 추가)
              </p>
              <code className="block rounded bg-muted px-3 py-2 text-sm">
                scenario = {scenario.name}
              </code>
              <CopyButton text={scenario.name} label="Name" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prompt Template</CardTitle>
            <CardDescription>
              Alert 수신 시 이 템플릿으로 Agent에게 전달됩니다
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="rounded bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
              {scenario.promptTemplate}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Invocation Log ({scenario.invocationCount})
            </CardTitle>
            <CardDescription>최근 webhook 호출 기록</CardDescription>
          </CardHeader>
          <CardContent>
            {invocations.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No invocations yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Alerts</TableHead>
                    <TableHead>Prompts</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invocations.map((inv) => (
                    <Fragment key={inv.id}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() =>
                          setExpandedId(expandedId === inv.id ? null : inv.id)
                        }
                      >
                        <TableCell className="text-xs tabular-nums">
                          <span className="mr-1">
                            {expandedId === inv.id ? "▼" : "▶"}
                          </span>
                          {new Date(inv.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              inv.status === "firing"
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {inv.alertCount}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs">
                          {inv.prompts[0]?.split("\n")[0]}
                        </TableCell>
                      </TableRow>
                      {expandedId === inv.id && (
                        <TableRow key={`${inv.id}-detail`}>
                          <TableCell colSpan={4} className="bg-muted/30 p-4">
                            <div className="space-y-3">
                              <div>
                                <p className="mb-1 text-xs font-medium text-muted-foreground">
                                  Alert Payload
                                </p>
                                <pre className="max-h-64 overflow-auto rounded bg-muted px-3 py-2 text-xs">
                                  {JSON.stringify(inv.payload, null, 2)}
                                </pre>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-medium text-muted-foreground">
                                  Generated Prompts
                                </p>
                                {inv.prompts.map((prompt, i) => (
                                  <pre
                                    key={i}
                                    className="mb-2 max-h-48 overflow-auto rounded bg-muted px-3 py-2 text-xs whitespace-pre-wrap"
                                  >
                                    {prompt}
                                  </pre>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
