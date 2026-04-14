"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  fetchScenario,
  updateScenario,
  type Scenario,
  type CreateScenarioInput,
} from "@/lib/api";
import { ScenarioForm } from "@/components/scenario-form";
import { buttonVariants } from "@/components/ui/button";

export default function EditScenarioPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [scenario, setScenario] = useState<Scenario | null>(null);

  useEffect(() => {
    fetchScenario(id).then(setScenario);
  }, [id]);

  async function handleSubmit(input: CreateScenarioInput) {
    await updateScenario(id, input);
    router.push(`/scenarios/${id}`);
  }

  if (!scenario) {
    return <p className="text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <button
          onClick={() => router.push(`/scenarios/${id}`)}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          &larr; Back
        </button>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">
        Edit: {scenario.name}
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Update scenario configuration
      </p>
      <ScenarioForm
        initialValues={scenario}
        onSubmit={handleSubmit}
        submitLabel="Update"
      />
    </div>
  );
}
