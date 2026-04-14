"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  fetchMcps,
  updateMcp,
  type CreateMcpInput,
  type Mcp,
  type UpdateMcpInput,
} from "@/lib/api";
import { McpForm } from "@/components/mcp-form";
import { McpToolsEditor } from "@/components/mcp-tools-editor";
import { buttonVariants } from "@/components/ui/button";

export default function EditMcpPage() {
  const router = useRouter();
  const params = useParams<{ name: string }>();
  const [mcp, setMcp] = useState<Mcp | null>(null);

  useEffect(() => {
    fetchMcps().then((all) => {
      const found = all.find((m) => m.name === params.name);
      setMcp(found ?? null);
    });
  }, [params.name]);

  async function handleSubmit(input: CreateMcpInput | UpdateMcpInput) {
    await updateMcp(params.name, input as UpdateMcpInput);
    router.push("/mcps");
  }

  if (!mcp) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  if (mcp.kind === "native") {
    return (
      <div className="mx-auto max-w-5xl">
        <p className="text-sm text-destructive">
          This MCP is native and cannot be edited.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <button
          onClick={() => router.push("/mcps")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          &larr; Back
        </button>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Edit MCP</h1>
      <p className="mb-6 text-sm text-muted-foreground">{mcp.name}</p>
      <McpForm
        initialValues={mcp}
        onSubmit={handleSubmit}
        submitLabel="Save"
        isEdit
      />

      <div className="mt-10">
        <McpToolsEditor
          mcpName={mcp.name}
          mcpKind={mcp.kind}
          defaultLevel={mcp.defaultLevel}
        />
      </div>
    </div>
  );
}
