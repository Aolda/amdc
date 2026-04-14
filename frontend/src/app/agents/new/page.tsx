"use client";

import { useRouter } from "next/navigation";
import { createAgent, type AgentInput } from "@/lib/api";
import { AgentForm } from "@/components/agent-form";
import { buttonVariants } from "@/components/ui/button";

export default function NewAgentPage() {
  const router = useRouter();

  async function handleSubmit(input: AgentInput) {
    await createAgent(input);
    router.push("/agents");
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <button
          onClick={() => router.push("/agents")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          &larr; Back
        </button>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">New Agent</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Define an agent and pick its skills
      </p>
      <AgentForm onSubmit={handleSubmit} submitLabel="Create" />
    </div>
  );
}
