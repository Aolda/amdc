"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  fetchSkill,
  updateSkill,
  type Skill,
  type SkillInput,
} from "@/lib/api";
import { SkillForm } from "@/components/skill-form";
import { buttonVariants } from "@/components/ui/button";

export default function EditSkillPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [skill, setSkill] = useState<Skill | null>(null);

  useEffect(() => {
    fetchSkill(params.id).then(setSkill);
  }, [params.id]);

  async function handleSubmit(input: SkillInput) {
    await updateSkill(params.id, input);
    router.push("/skills");
  }

  if (!skill) {
    return <p className="text-muted-foreground">Loading...</p>;
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
      <h1 className="text-2xl font-bold tracking-tight">Edit Skill</h1>
      <p className="mb-6 text-sm text-muted-foreground">{skill.name}</p>
      <SkillForm
        initialValues={skill}
        onSubmit={handleSubmit}
        submitLabel="Save"
      />
    </div>
  );
}
