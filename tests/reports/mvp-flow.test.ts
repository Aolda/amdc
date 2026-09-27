import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reportMvpFixture } from "../../examples/report-mvp.js";
import { createReportCommandHandler, type ReportInteraction } from "../../src/adapters/discord/report-command.js";
import { createReportFlow } from "../../src/app/report-flow.js";
import type { DiagnosisRequest, DiagnosticRunnerContext } from "../../src/diagnostic/types.js";
import { createMvpReport, type MvpReport } from "../../src/report-agent/mvp-report.js";
import type { ReportModelAdapter, ReportModelRequest } from "../../src/report-agent/report-agent.js";
import { createSecretDetector } from "../../src/report-agent/security.js";
import { formatMvpDiscordReport } from "../../src/reports/mvp-discord-formatter.js";
import { createFileMvpReportStore, type MvpReportStore } from "../../src/reports/mvp-report-store.js";

const detector = createSecretDetector(["PRIVATE_MARKER"]);
const context: DiagnosticRunnerContext = { environment: "dev", runnerMode: "langchain", agentModel: "fake" };
const request = (symptom = "데이터베이스 지연 조사"): DiagnosisRequest => ({
  symptom, requestedBy: "tester", source: "discord", receivedAt: "2026-09-27T00:00:01.000Z",
});
const id = () => `diag-${randomUUID()}`;

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "amdc-mvp-flow-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

function model(result: unknown = { suspected_cause: "잠금 경합이 지연에 기여했을 가능성이 있습니다." }) {
  const calls: ReportModelRequest[] = [];
  const adapter: ReportModelAdapter = {
    async generate(input, _options) { calls.push(input); return result; },
  };
  return { adapter, calls };
}

function interaction(overrides: Partial<ReportInteraction> = {}) {
  const edits: Parameters<ReportInteraction["editReply"]>[0][] = [];
  let acks = 0;
  const value: ReportInteraction = {
    id: "interaction-1", guildId: "guild-1", createdTimestamp: 1000,
    user: { username: "tester" }, options: { getString: () => "데이터베이스 지연 조사" },
    async deferReply() { acks += 1; },
    async editReply(payload) { edits.push(payload); },
    ...overrides,
  };
  return { value, edits, get acks() { return acks; } };
}

test("real ledger reaches fake model, persistent reload, then one safe Discord attachment", async () => {
  await withDirectory(async (directory) => {
    const diagnosisId = id();
    const handoff = reportMvpFixture(diagnosisId);
    const store = createFileMvpReportStore(directory, detector);
    const fake = model();
    let diagnoses = 0;
    let persistedBeforeEdit = false;
    const flow = createReportFlow({
      diagnose: async () => { diagnoses += 1; return { diagnosis: handoff, presentation: handoff }; },
      model: fake.adapter, store, containsSecret: detector,
    });
    const current = interaction({ id: "one", async editReply(payload) {
      persistedBeforeEdit = (await store.read(diagnosisId)) !== null;
      current.edits.push(payload);
    } });
    const handler = createReportCommandHandler({
      guildId: "guild-1", runnerMode: "langchain", now: () => 1000,
      runReport: input => flow(input, context), containsSecret: detector, log: () => undefined,
    });
    await handler(current.value);
    assert.equal(diagnoses, 1);
    assert.equal(fake.calls.length, 1);
    assert.equal(current.acks, 1);
    assert.equal(current.edits.length, 1);
    assert.equal(persistedBeforeEdit, true);
    const saved = await store.read(diagnosisId);
    assert.equal(saved?.observations.length, 2);
    assert.equal(saved?.observations[1].error_code, "source_permission_denied");
    assert.match(saved?.observations[0].diagnostic_comment?.observation ?? "", /잠금 대기 한 건/);
    const payload = current.edits[0];
    assert.equal(payload.files?.length, 1);
    assert.equal(payload.files?.[0].name, "amdc-report.md");
    assert.deepEqual(payload.allowedMentions.parse, []);
    assert.ok(payload.content.length <= 1900);
    const raw = JSON.stringify(handoff);
    assert.match(raw, /waitSeconds/);
    for (const output of [JSON.stringify(fake.calls), JSON.stringify(saved), payload.content, payload.files![0].attachment.toString("utf8")]) {
      assert.doesNotMatch(output, /waitSeconds|"rows"|"appliedFilters"|PRIVATE_MARKER/);
    }
  });
});

test("duplicate interaction objects claim once before acknowledgement", async () => {
  await withDirectory(async (directory) => {
    const handoff = reportMvpFixture();
    const fake = model();
    const store = createFileMvpReportStore(directory, detector);
    let diagnoses = 0;
    const flow = createReportFlow({
      diagnose: async () => { diagnoses += 1; return { diagnosis: handoff, presentation: handoff }; },
      model: fake.adapter, store, containsSecret: detector,
    });
    const handler = createReportCommandHandler({
      guildId: "guild-1", runnerMode: "langchain", now: () => 1000,
      runReport: input => flow(input, context), containsSecret: detector, log: () => undefined,
    });
    const first = interaction({ id: "same" });
    const second = interaction({ id: "same" });
    await Promise.all([handler(first.value), handler(second.value)]);
    assert.equal(first.acks + second.acks, 1);
    assert.equal(first.edits.length + second.edits.length, 1);
    assert.equal(diagnoses, 1);
    assert.equal(fake.calls.length, 1);
  });
});

test("ten concurrent flows keep diagnosis IDs, call references and files isolated", async () => {
  await withDirectory(async (directory) => {
    const ids = Array.from({ length: 10 }, id);
    const handoffs = new Map(ids.map((diagnosisId, index) => [String(index), reportMvpFixture(diagnosisId)]));
    const store = createFileMvpReportStore(directory, detector);
    const fake = model();
    const flow = createReportFlow({
      diagnose: async input => {
        const handoff = handoffs.get(input.symptom);
        assert.ok(handoff);
        return { diagnosis: handoff, presentation: handoff };
      },
      model: fake.adapter, store, containsSecret: detector,
    });
    const reports = await Promise.all(ids.map((_, index) => flow(request(String(index)), context)));
    assert.equal(fake.calls.length, 10);
    assert.deepEqual(new Set(reports.map(item => item.diagnosis_id)), new Set(ids));
    for (const report of reports) {
      assert.ok(report.observations.every(item => item.tool_call_id.startsWith(`${report.diagnosis_id}:call-`)));
      assert.deepEqual(await store.read(report.diagnosis_id), report);
      assert.equal(JSON.parse(await readFile(join(directory, `${report.diagnosis_id}.json`), "utf8")).diagnosis_id, report.diagnosis_id);
    }
  });
});

test("ambiguous delivery failure leaves the saved report unchanged and never edits twice", async () => {
  await withDirectory(async (directory) => {
    const diagnosisId = id();
    const handoff = reportMvpFixture(diagnosisId);
    const store = createFileMvpReportStore(directory, detector);
    const flow = createReportFlow({
      diagnose: async () => ({ diagnosis: handoff, presentation: handoff }),
      model: model().adapter, store, containsSecret: detector,
    });
    let edits = 0;
    let persistedAtDelivery: string | undefined;
    const handler = createReportCommandHandler({
      guildId: "guild-1", runnerMode: "langchain", now: () => 1000,
      runReport: input => flow(input, context), containsSecret: detector, log: () => undefined,
    });
    const current = interaction({ id: "uncertain", async editReply() {
      edits += 1;
      persistedAtDelivery = await readFile(join(directory, `${diagnosisId}.json`), "utf8");
      throw new Error("delivery outcome unknown");
    } });
    await handler(current.value);
    await handler(interaction({ id: "uncertain" }).value);
    assert.equal(edits, 1);
    assert.equal(await readFile(join(directory, `${diagnosisId}.json`), "utf8"), persistedAtDelivery);
  });
});

test("bad handoff, model and storage failures produce one safe message without report payload", async () => {
  await withDirectory(async (directory) => {
    const good = reportMvpFixture();
    const invalid = { ...good, completion_reason: "mock" } as typeof good;
    const rejectingStore: MvpReportStore = {
      async save() { throw new Error("private storage path"); },
      async read() { return null; },
    };
    const cases = [
      { handoff: invalid, adapter: model().adapter, store: createFileMvpReportStore(directory, detector) },
      { handoff: good, adapter: model({ suspected_cause: "cause", extra: "private" }).adapter, store: createFileMvpReportStore(directory, detector) },
      { handoff: good, adapter: model().adapter, store: rejectingStore },
    ];
    for (const [index, currentCase] of cases.entries()) {
      const flow = createReportFlow({
        diagnose: async () => ({ diagnosis: currentCase.handoff, presentation: currentCase.handoff }),
        model: currentCase.adapter, store: currentCase.store, containsSecret: detector,
      });
      const current = interaction({ id: `bad-${index}` });
      const handler = createReportCommandHandler({
        guildId: "guild-1", runnerMode: "langchain", now: () => 1000,
        runReport: input => flow(input, context), containsSecret: detector, log: () => undefined,
      });
      await handler(current.value);
      assert.equal(current.acks, 1);
      assert.equal(current.edits.length, 1);
      assert.equal(current.edits[0].files, undefined);
      assert.doesNotMatch(current.edits[0].content, /diag-|waitSeconds|private/);
    }
  });
});

test("mock, wrong guild, expired interaction and failed acknowledgement do not diagnose", async () => {
  let diagnoses = 0;
  const dependencies = {
    guildId: "guild-1", runnerMode: "langchain" as const, now: () => 1000,
    runReport: async (_input: DiagnosisRequest): Promise<MvpReport> => { diagnoses += 1; throw new Error("unexpected diagnosis"); },
    containsSecret: detector, log: () => undefined,
  };
  const mock = interaction({ id: "mock" });
  await createReportCommandHandler({ ...dependencies, runnerMode: "mock" })(mock.value);
  assert.equal(mock.acks, 1);
  assert.equal(mock.edits.length, 1);
  assert.equal(mock.edits[0].files, undefined);
  const wrong = interaction({ id: "wrong", guildId: "other" });
  await createReportCommandHandler(dependencies)(wrong.value);
  const expired = interaction({ id: "expired", createdTimestamp: 1000 - 15 * 60 * 1000 });
  await createReportCommandHandler(dependencies)(expired.value);
  const ackFailed = interaction({ id: "ack-failed", async deferReply() { throw new Error("ack failed"); } });
  await createReportCommandHandler(dependencies)(ackFailed.value);
  assert.equal(wrong.acks + expired.acks, 0);
  assert.equal(ackFailed.edits.length, 0);
  assert.equal(diagnoses, 0);
});

test("formatter stays within Discord content limit and rejects secrets", async () => {
  const report = await createMvpReport(reportMvpFixture(), { model: model().adapter, containsSecret: detector });
  const formatted = formatMvpDiscordReport(report, detector);
  assert.ok(formatted.content.length <= 1900);
  assert.equal(formatted.files.length, 1);
  assert.throws(() => formatMvpDiscordReport({ ...report, summary: "PRIVATE_MARKER" }, detector));
});
