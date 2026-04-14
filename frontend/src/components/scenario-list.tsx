"use client";

import Link from "next/link";
import { type Scenario, deleteScenario, updateScenario } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Props {
  scenarios: Scenario[];
  onRefresh: () => void;
}

export function ScenarioList({ scenarios, onRefresh }: Props) {
  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this scenario?")) return;
    await deleteScenario(id);
    onRefresh();
  }

  async function handleToggle(scenario: Scenario) {
    await updateScenario(scenario.id, { enabled: !scenario.enabled });
    onRefresh();
  }

  if (scenarios.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground">
        No scenarios configured yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Invocations</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {scenarios.map((s) => (
          <TableRow key={s.id}>
            <TableCell>
              <Link
                href={`/scenarios/${s.id}`}
                className="font-medium hover:underline"
              >
                {s.name}
              </Link>
              {s.description && (
                <p className="text-xs text-muted-foreground">{s.description}</p>
              )}
            </TableCell>
            <TableCell className="tabular-nums">{s.invocationCount}</TableCell>
            <TableCell>
              <button onClick={() => handleToggle(s)}>
                <Badge
                  variant={s.enabled ? "default" : "secondary"}
                  className="cursor-pointer"
                >
                  {s.enabled ? "Active" : "Disabled"}
                </Badge>
              </button>
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <Link
                  href={`/scenarios/${s.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Detail
                </Link>
                <Link
                  href={`/scenarios/${s.id}/edit`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Edit
                </Link>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(s.id)}
                >
                  Delete
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
