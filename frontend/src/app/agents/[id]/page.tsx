"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  fetchAgent,
  updateAgent,
  type Agent,
  type AgentInput,
} from "@/lib/api";
import { AgentForm } from "@/components/agent-form";
import { buttonVariants } from "@/components/ui/button";

export default function EditAgentPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);

  useEffect(() => {
    fetchAgent(params.id).then(setAgent);
  }, [params.id]);

  async function handleSubmit(input: AgentInput) {
    await updateAgent(params.id, input);
    router.push("/agents");
  }

  if (!agent) {
    return <p className="text-muted-foreground">Loading...</p>;
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
      <h1 className="text-2xl font-bold tracking-tight">Edit Agent</h1>
      <p className="mb-6 text-sm text-muted-foreground">{agent.name}</p>
      <AgentForm
        initialValues={agent}
        onSubmit={handleSubmit}
        submitLabel="Save"
      />
    </div>
  );
}
