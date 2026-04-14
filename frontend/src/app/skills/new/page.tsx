"use client";

import { useRouter } from "next/navigation";
import { createSkill, type SkillInput } from "@/lib/api";
import { SkillForm } from "@/components/skill-form";
import { buttonVariants } from "@/components/ui/button";

export default function NewSkillPage() {
  const router = useRouter();

  async function handleSubmit(input: SkillInput) {
    await createSkill(input);
    router.push("/skills");
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <button
          onClick={() => router.push("/skills")}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          &larr; Back
        </button>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">New Skill</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Define a reusable skill that agents can pick up
      </p>
      <SkillForm onSubmit={handleSubmit} submitLabel="Create" />
    </div>
  );
}
