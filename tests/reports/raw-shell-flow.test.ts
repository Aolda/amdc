import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createReportCommandHandler, type ReportInteraction } from "../../src/adapters/discord/report-command.js";
import { createReportFlow } from "../../src/app/report-flow.js";
import type { DiagnosticRunnerContext } from "../../src/diagnostic/types.js";
import { DiagnosisLedger } from "../../src/report/diagnosis-handoff.js";
import type { MvpReport } from "../../src/report-agent/mvp-report.js";
import type { ReportModelAdapter, ReportModelRequest } from "../../src/report-agent/report-agent.js";
import { createSecretDetector } from "../../src/report-agent/security.js";
import type { MvpReportStore } from "../../src/reports/mvp-report-store.js";
import type { AgentVisibleToolDescriptor } from "../../src/tools/types.js";

const customerIdentifier = "synthetic-customer-identifier-123";
const observedAt = "2026-09-27T00:00:00.000Z";
const context: DiagnosticRunnerContext = { environment: "dev", runnerMode: "langchain", agentModel: "fake" };
const containsSecret = createSecretDetector();
const descriptor: AgentVisibleToolDescriptor = {
  name: "backend_health", pluginName: "backend", description: "Synthetic health lookup",
  readOnly: true, inputSchema: { type: "object", additionalProperties: false },
};

function producerHandoff(stream: "stdout" | "stderr", newline: "\n" | "\r\n", observation: string,
  representation: "nested" | "duplicate" | "trailer" = "nested") {
  const ledger = new DiagnosisLedger(`diag-${randomUUID()}`);
  const call = ledger.begin(descriptor, {});
  const nested = JSON.stringify({ status: "ok", details: { customer: { identifier: customerIdentifier } } });
  const body = representation === "duplicate" ? `{"customer":"${customerIdentifier}","customer":"public"}`
    : representation === "trailer" ? `${nested}X-Checksum: synthetic-checksum${newline}` : nested;
  const output = `HTTP/1.1 200 OK${newline}Content-Type: application/json${newline}${newline}${body}`;
  ledger.finish(call, { ok: true, rawResult: {
    toolName: descriptor.name, pluginName: descriptor.pluginName, source: "http_health",
    collectedAt: observedAt, transport: "local_shell",
    execution: { stdout: stream === "stdout" ? output : "", stderr: stream === "stderr" ? output : "", exitCode: 0 },
  } });
  return ledger.assemble("서비스 상태를 조사해주세요.", {
    completion_reason: "investigation_complete",
    comments: [{ tool_call_id: call.tool_call_id,
      comment: { observation, hypothesis: null, limitation: null }, related_call_ids: [] }],
  });
}

async function runCommand(handoff: ReturnType<typeof producerHandoff>) {
  const modelCalls: ReportModelRequest[] = [];
  const model: ReportModelAdapter = {
    async generate(input) { modelCalls.push(input); return { suspected_cause: "추가 점검이 필요합니다." }; },
  };
  const saved = new Map<string, MvpReport>();
  let saves = 0;
  let reads = 0;
  const store: MvpReportStore = {
    async save(report) { saves += 1; saved.set(report.diagnosis_id, structuredClone(report)); },
    async read(diagnosisId) { reads += 1; return structuredClone(saved.get(diagnosisId) ?? null); },
  };
  const replies: Parameters<ReportInteraction["editReply"]>[0][] = [];
  let acknowledgements = 0;
  const interaction: ReportInteraction = {
    id: randomUUID(), guildId: "guild-1", createdTimestamp: 1000,
    user: { username: "tester" }, options: { getString: () => "서비스 상태 조사" },
    async deferReply() { acknowledgements += 1; },
    async editReply(payload) { replies.push(payload); },
  };
  const flow = createReportFlow({
    diagnose: async () => ({ diagnosis: handoff, presentation: handoff }),
    model, store, containsSecret,
  });
  const command = createReportCommandHandler({
    guildId: "guild-1", runnerMode: "langchain", now: () => 1000,
    runReport: request => flow(request, context), containsSecret, log: () => undefined,
  });
  await command(interaction);
  return { modelCalls, saved, saves, reads, replies, acknowledgements };
}

for (const stream of ["stdout", "stderr"] as const) {
  for (const newline of ["\n", "\r\n"] as const) {
    test(`copied nested JSON scalar from ${stream} with ${newline === "\n" ? "LF" : "CRLF"} fails before model, persistence and Discord attachment`, async () => {
      const handoff = producerHandoff(stream, newline, `응답에 ${customerIdentifier}가 포함되었습니다.`);
      const result = await runCommand(handoff);
      assert.equal(result.acknowledgements, 1);
      assert.equal(result.modelCalls.length, 0);
      assert.equal(result.saves, 0);
      assert.equal(result.reads, 0);
      assert.equal(result.saved.size, 0);
      assert.equal(result.replies.length, 1);
      assert.equal(result.replies[0].files, undefined);
      assert.equal(result.replies[0].content, "AMDC 보고서 응답을 준비하지 못했습니다. 서버 설정과 저장된 진단 기록을 확인해주세요.");
      assert.doesNotMatch(JSON.stringify(result.replies), /synthetic-customer-identifier-123/);
    });
  }
}

test("noncopy diagnostic comment still reaches model, persisted reload and Discord attachment", async () => {
  const handoff = producerHandoff("stdout", "\r\n", "상태 응답을 받았지만 이 결과만으로 원인을 확정할 수 없습니다.");
  const result = await runCommand(handoff);
  assert.equal(result.acknowledgements, 1);
  assert.equal(result.modelCalls.length, 1);
  assert.equal(result.saves, 1);
  assert.equal(result.reads, 1);
  assert.equal(result.saved.size, 1);
  assert.equal(result.replies.length, 1);
  assert.equal(result.replies[0].files?.length, 1);
  assert.equal(result.replies[0].files?.[0].name, "amdc-report.md");
  for (const exposed of [result.modelCalls, [...result.saved.values()], result.replies]) {
    assert.doesNotMatch(JSON.stringify(exposed), /synthetic-customer-identifier-123/);
  }
});

for (const representation of ["duplicate", "trailer"] as const) {
  for (const stream of ["stdout", "stderr"] as const) {
    test(`${representation} JSON from ${stream} fails before persistence and attachment`, async () => {
      const handoff = producerHandoff(stream, "\r\n", `응답에 ${customerIdentifier}가 포함되었습니다.`, representation);
      const result = await runCommand(handoff);
      assert.equal(result.modelCalls.length, 0);
      assert.equal(result.saves, 0);
      assert.equal(result.reads, 0);
      assert.equal(result.saved.size, 0);
      assert.equal(result.replies.length, 1);
      assert.equal(result.replies[0].files, undefined);
      assert.doesNotMatch(JSON.stringify(result.replies), /synthetic-customer-identifier-123/);
    });
  }
}
