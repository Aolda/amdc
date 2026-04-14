"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchAgents, deleteAgent, type Agent } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setAgents(await fetchAgents());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this agent?")) return;
    await deleteAgent(id);
    load();
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground">
            agent.md instructions + selected skills
          </p>
        </div>
        <Link href="/agents/new" className={buttonVariants()}>
          + New Agent
        </Link>
      </div>

      <div className="mt-6">
        {loading && (
          <p className="py-8 text-center text-muted-foreground">Loading...</p>
        )}
        {!loading && agents.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">
            No agents yet.
          </p>
        )}
        {!loading && agents.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Skills</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link
                      href={`/agents/${a.id}`}
                      className="font-medium hover:underline"
                    >
                      {a.name}
                    </Link>
                    {a.description && (
                      <p className="text-xs text-muted-foreground">
                        {a.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {a.skillIds.length}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/agents/${a.id}`}
                        className={buttonVariants({
                          variant: "outline",
                          size: "sm",
                        })}
                      >
                        Edit
                      </Link>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(a.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
