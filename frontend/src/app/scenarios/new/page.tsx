"use client";

import { useRouter } from "next/navigation";
import { createScenario, type CreateScenarioInput } from "@/lib/api";
import { ScenarioForm } from "@/components/scenario-form";
import { buttonVariants } from "@/components/ui/button";

export default function NewScenarioPage() {
  const router = useRouter();

  async function handleSubmit(input: CreateScenarioInput) {
    const created = await createScenario(input);
    router.push(`/scenarios/${created.id}`);
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <button
          onClick={() => router.push("/scenarios")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          &larr; Back
        </button>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">New Scenario</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Create a new alert scenario with webhook endpoint
      </p>
      <ScenarioForm onSubmit={handleSubmit} submitLabel="Create" />
    </div>
  );
}
