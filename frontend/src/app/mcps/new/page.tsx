"use client";

import { useRouter } from "next/navigation";
import { createMcp, type CreateMcpInput, type UpdateMcpInput } from "@/lib/api";
import { McpForm } from "@/components/mcp-form";
import { buttonVariants } from "@/components/ui/button";

export default function NewMcpPage() {
  const router = useRouter();

  async function handleSubmit(input: CreateMcpInput | UpdateMcpInput) {
    await createMcp(input as CreateMcpInput);
    router.push("/mcps");
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
      <h1 className="text-2xl font-bold tracking-tight">New Upstream MCP</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Register a remote MCP server. proxy_mcp will lazily connect on first use
        and forward tool calls.
      </p>
      <McpForm onSubmit={handleSubmit} submitLabel="Create" />
    </div>
  );
}
