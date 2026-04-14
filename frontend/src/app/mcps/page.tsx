"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchMcps, deleteMcp, type Mcp } from "@/lib/api";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function McpsPage() {
  const [mcps, setMcps] = useState<Mcp[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setMcps(await fetchMcps());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDelete(name: string) {
    if (!confirm(`Delete MCP '${name}'?`)) return;
    try {
      await deleteMcp(name);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCPs</h1>
          <p className="text-sm text-muted-foreground">
            Tool providers wrapped by proxy_mcp. Native MCPs are read-only;
            upstream MCPs are user-configurable.
          </p>
        </div>
        <Link href="/mcps/new" className={buttonVariants()}>
          + New Upstream MCP
        </Link>
      </div>

      <div className="mt-6">
        {loading && (
          <p className="py-8 text-center text-muted-foreground">Loading...</p>
        )}
        {!loading && mcps.length === 0 && (
          <p className="py-8 text-center text-muted-foreground">
            No MCPs registered.
          </p>
        )}
        {!loading && mcps.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Default level</TableHead>
                <TableHead>Upstream URL</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mcps.map((m) => {
                const isUpstream = m.kind === "upstream";
                return (
                  <TableRow key={m.name}>
                    <TableCell>
                      <span className="font-medium">{m.name}</span>
                      {m.description && (
                        <p className="text-xs text-muted-foreground">
                          {m.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {m.kind}
                      </span>
                    </TableCell>
                    <TableCell>{m.defaultLevel}</TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {m.upstreamUrl ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {isUpstream ? (
                          <>
                            <Link
                              href={`/mcps/${encodeURIComponent(m.name)}`}
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
                              onClick={() => handleDelete(m.name)}
                            >
                              Delete
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            read-only
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
