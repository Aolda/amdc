"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchScenarios, type Scenario } from "@/lib/api";
import { ScenarioList } from "@/components/scenario-list";
import { buttonVariants } from "@/components/ui/button";

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await fetchScenarios();
    setScenarios(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Scenarios</h1>
          <p className="text-sm text-muted-foreground">
            Manage alert scenarios and webhook endpoints
          </p>
        </div>
        <Link href="/scenarios/new" className={buttonVariants()}>
          + New Scenario
        </Link>
      </div>
      <div className="mt-6">
        {loading ? (
          <p className="py-8 text-center text-muted-foreground">Loading...</p>
        ) : (
          <ScenarioList scenarios={scenarios} onRefresh={load} />
        )}
      </div>
    </div>
  );
}
