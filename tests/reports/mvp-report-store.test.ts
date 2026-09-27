import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { MvpReport } from "../../src/report-agent/mvp-report.js";
import { createFileMvpReportStore, MvpReportStorageError } from "../../src/reports/mvp-report-store.js";

const ID = "diag-123e4567-e89b-42d3-a456-426614174000";
const containsSecret = (value: string) => value.includes("PRIVATE_MARKER");
const storageFailure = (error: unknown) => error instanceof MvpReportStorageError && error.code === "storage_failure";
const alreadyExists = (error: unknown) => error instanceof MvpReportStorageError && error.code === "report_already_exists";

function report(summary = "조사 결과"): MvpReport {
  return {
    schema_version: "diagnosis-report/1.0.0",
    diagnosis_id: ID,
    created_at: "2026-09-27T00:00:00.000Z",
    completion_reason: "investigation_complete",
    summary,
    observations: [{
      seq: 1,
      tool_call_id: `${ID}:call-1`,
      tool: "health_check",
      plugin: "fake_source",
      observed_at: "2026-09-27T00:00:00.000Z",
      status: "success",
      error_code: null,
      execution_summary: "Tool collection completed; source status normal.",
      diagnostic_comment: null,
      related_call_ids: [],
    }],
    limitations: [],
    suspected_cause: null,
    recommended_next_action: "기존 모니터링을 계속한다.",
  };
}

async function withStore(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "amdc-mvp-report-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("saved report survives caller mutation and read returns a separate validated object", async () => {
  await withStore(async (directory) => {
    const store = createFileMvpReportStore(directory, containsSecret);
    const input = report();
    await store.save(input);
    (input as { summary: string }).summary = "변경된 호출자 값";
    const first = await store.read(ID);
    assert.equal(first?.summary, "조사 결과");
    assert.notStrictEqual(first, input);
    (first as { summary: string }).summary = "변경된 읽기 값";
    assert.equal((await store.read(ID))?.summary, "조사 결과");
    assert.equal(await store.read("diag-123e4567-e89b-42d3-a456-426614174001"), null);
  });
});

test("invalid IDs, secrets and corrupt files fail without revealing data or publishing a report", async () => {
  await withStore(async (directory) => {
    const store = createFileMvpReportStore(directory, containsSecret);
    await assert.rejects(store.read("../outside"), storageFailure);
    await assert.rejects(store.save({ ...report(), diagnosis_id: "../outside" }), storageFailure);
    await assert.rejects(store.save(report("PRIVATE_MARKER")), storageFailure);
    assert.deepEqual(await readdir(directory), []);

    const destination = join(directory, `${ID}.json`);
    await writeFile(destination, "{broken JSON");
    await assert.rejects(store.read(ID), storageFailure);
    await writeFile(destination, JSON.stringify({ ...report(), schema_version: "diagnosis-report/9.0.0" }));
    await assert.rejects(store.read(ID), storageFailure);
    await writeFile(destination, JSON.stringify(report("PRIVATE_MARKER")));
    await assert.rejects(store.read(ID), storageFailure);
    await writeFile(destination, "x".repeat(256 * 1024 + 1));
    await assert.rejects(store.read(ID), storageFailure);
  });
});

test("reports above the persisted 256 KiB limit are rejected before publication", async () => {
  await withStore(async (directory) => {
    const store = createFileMvpReportStore(directory, containsSecret);
    const oversized = report();
    oversized.observations = Array.from({ length: 100 }, (_, index) => ({
      ...oversized.observations[0],
      seq: index + 1,
      tool_call_id: `${ID}:call-${index + 1}`,
      diagnostic_comment: {
        observation: "a".repeat(1000),
        hypothesis: "b".repeat(1000),
        limitation: "c".repeat(1000),
      },
    }));
    await assert.rejects(store.save(oversized), storageFailure);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("filesystem publication failure leaves no completed report and hides path details", async () => {
  await withStore(async (directory) => {
    const blockedDirectory = join(directory, "blocked");
    await writeFile(blockedDirectory, "reserved");
    const store = createFileMvpReportStore(blockedDirectory, containsSecret);
    await assert.rejects(store.save(report()), (error: unknown) =>
      storageFailure(error) && (error as Error).message === "storage_failure");
    assert.deepEqual(await readdir(directory), ["blocked"]);
    assert.equal(await readFile(blockedDirectory, "utf8"), "reserved");
  });
});

test("concurrent writers for one ID publish exactly one report and never overwrite it", async () => {
  await withStore(async (directory) => {
    const store = createFileMvpReportStore(directory, containsSecret);
    const outcomes = await Promise.allSettled([
      store.save(report("첫 보고서")),
      store.save(report("둘째 보고서")),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(rejected?.status === "rejected" && alreadyExists(rejected.reason));
    const destination = join(directory, `${ID}.json`);
    const published = await readFile(destination, "utf8");
    assert.equal((await store.read(ID))?.summary, JSON.parse(published).summary);
    await assert.rejects(store.save(report("셋째 보고서")), alreadyExists);
    assert.equal(await readFile(destination, "utf8"), published);
    assert.deepEqual(await readdir(directory), [`${ID}.json`]);
  });
});
