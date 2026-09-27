import assert from "node:assert/strict";
import { test } from "node:test";
import { DiagnosisLedger, handoffDraftSchema } from "../src/report/diagnosis-handoff.js";
import { createAmdcLangChainTools } from "../src/agent/langchain-tool-wrapper.js";
import type { AgentVisibleToolDescriptor, ToolRuntimeResult } from "../src/tools/types.js";
import { DiagnosisPipeline } from "../src/app/diagnosis-pipeline.js";
import { TemporaryDiagnosticPresenter } from "../src/report/temporary-diagnostic-presenter.js";
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { LangChainDiagnosticAgent } from "../src/agent/langchain-diagnostic-agent.js";
import { PluginRegistry } from "../src/tools/plugin-registry.js";

const descriptor: AgentVisibleToolDescriptor = {
  name: "mysql_read", pluginName: "mysql", description: "Read rows", readOnly: true,
  inputSchema: { type: "object", additionalProperties: false, properties: { connectionId: { type: "integer" } } }
};
const empty: ToolRuntimeResult = { ok: true, rawResult: {
  toolName: descriptor.name, pluginName: "mysql", source: "mysql", transport: "mysql",
  collectedAt: "2026-09-19T00:00:00.000Z", rows: [], appliedFilters: {}, returnedRows: 0, limit: 100, truncated: false
} };
const draft = { completion_reason: "investigation_complete", comments: [] };

test("raw empty results, errors and independent model annotations are preserved", () => {
  const ledger = new DiagnosisLedger("diag-1");
  const call = ledger.begin(descriptor, {});
  ledger.finish(call, empty);
  const failed = ledger.begin(descriptor, { connectionId: 382 });
  ledger.finish(failed, { ok: false, error: { toolName: descriptor.name, pluginName: "mysql", code: "tool_timeout", message: "Timed out", occurredAt: "2026-09-19T00:01:00.000Z" } });
  const comment = { observation: null, hypothesis: null, limitation: "세션 조회 timeout으로 상태를 확인하지 못했다." };
  const handoff = ledger.assemble("느림", { ...draft, completion_reason: "insufficient_evidence", comments: [{ tool_call_id: failed.tool_call_id, comment, related_call_ids: [call.tool_call_id] }] });
  assert.deepEqual(handoff.observations[0].result, empty.rawResult);
  assert.equal(handoff.observations[0].comment, null);
  assert.equal(handoff.observations[0].status, "success");
  assert.equal(handoff.observations[1].result, null);
  assert.equal(handoff.observations[1].error?.code, "tool_timeout");
  assert.deepEqual(handoff.observations[1].comment, comment);
  assert.deepEqual(handoff.observations[1].related_call_ids, [call.tool_call_id]);
  assert.deepEqual(Object.keys(handoff).sort(), ["completion_reason", "diagnosis_id", "observations", "request"]);
});

test("model cannot supply results, fabricate IDs, duplicate annotations or reference itself", () => {
  const ledger = new DiagnosisLedger("diag-1");
  const first = ledger.begin(descriptor, {}); ledger.finish(first, empty);
  const second = ledger.begin(descriptor, {}); ledger.finish(second, empty);
  const annotation = { tool_call_id: first.tool_call_id, comment: null, related_call_ids: [] };
  assert.equal(handoffDraftSchema.safeParse({ ...draft, observations: [] }).success, false);
  assert.equal(handoffDraftSchema.safeParse({ ...draft, comments: [{ ...annotation, result: {} }] }).success, false);
  for (const comments of [
    [{ ...annotation, tool_call_id: "invented" }], [annotation, annotation],
    [{ ...annotation, related_call_ids: [first.tool_call_id] }],
    [{ ...annotation, related_call_ids: [second.tool_call_id, second.tool_call_id] }],
    [{ ...annotation, related_call_ids: ["invented"] }]
  ]) assert.throws(() => ledger.assemble("test", { ...draft, comments }), /reference/);
  const handoff = ledger.assemble("test", { ...draft, comments: [
    { ...annotation, related_call_ids: [second.tool_call_id] },
    { ...annotation, tool_call_id: second.tool_call_id, related_call_ids: [first.tool_call_id] }
  ] });
  assert.deepEqual(handoff.observations.map(call => call.related_call_ids), [[second.tool_call_id], [first.tool_call_id]]);
});

test("parallel tool completion preserves dispatch order and exposes matching IDs to the model", async () => {
  const ledger = new DiagnosisLedger("diag-parallel");
  let finishFirst!: () => void;
  const gate = new Promise<void>(resolve => { finishFirst = resolve; });
  const [tool] = createAmdcLangChainTools([descriptor], { execute: async request => {
    if ((request.args as { connectionId: number }).connectionId === 1) await gate;
    else finishFirst();
    return empty;
  } }, { environment: "dev", referenceTime: new Date(), runId: "diag-parallel", ledger, traceSink: { record: async () => {} } });
  const results = await Promise.all([tool.invoke({ connectionId: 1 }), tool.invoke({ connectionId: 2 })]);
  const handoff = ledger.assemble("test", draft);
  assert.deepEqual(handoff.observations.map(call => call.seq), [1, 2]);
  assert.deepEqual(handoff.observations.map(call => call.input.connectionId), [1, 2]);
  assert.deepEqual(results.map(result => JSON.parse(String(result)).tool_call_id), handoff.observations.map(call => call.tool_call_id));
});

test("unexpected runtime errors are sanitized and recorded, repeated attempts are not lost", async () => {
  const ledger = new DiagnosisLedger("diag-errors");
  let calls = 0;
  const [tool] = createAmdcLangChainTools([descriptor], { execute: async () => { calls++; throw new Error("private upstream body"); } }, { environment: "dev", referenceTime: new Date(), runId: "diag-errors", ledger, traceSink: { record: async () => {} } });
  await tool.invoke({}); await tool.invoke({});
  const handoff = ledger.assemble("test", draft);
  assert.equal(calls, 1);
  assert.deepEqual(handoff.observations.map(call => call.error?.code), ["source_request_failed", "invalid_input"]);
  assert.doesNotMatch(JSON.stringify(handoff), /private upstream/);
});

test("handoff isolates runs and clones snapshots; zero calls cannot claim completed investigation", async () => {
  const runs = await Promise.all(Array.from({ length: 100 }, async (_, index) => {
    const ledger = new DiagnosisLedger(`diag-${index}`);
    const input = { connectionId: index };
    const call = ledger.begin(descriptor, input); input.connectionId = -1;
    ledger.finish(call, empty);
    return ledger.assemble("test", draft);
  }));
  assert.equal(new Set(runs.map(run => run.observations[0].tool_call_id)).size, 100);
  runs.forEach((run, index) => assert.equal(run.observations[0].input.connectionId, index));
  assert.equal(new DiagnosisLedger("none").assemble("test", draft).completion_reason, "insufficient_evidence");
});

test("request, tool inputs, result and model comment cannot reintroduce configured secrets", () => {
  const key = "AMDC_HANDOFF_TEST_SECRET";
  const previous = process.env[key]; process.env[key] = "fixture-secret-12345";
  try {
    const ledger = new DiagnosisLedger("diag-security");
    assert.throws(() => ledger.begin(descriptor, { connectionId: process.env[key] }), /sensitive/);
    const call = ledger.begin(descriptor, {}); ledger.finish(call, empty);
    assert.throws(() => ledger.assemble(process.env[key]!, draft), /sensitive/);
    assert.throws(() => ledger.assemble("test", { ...draft, comments: [{ tool_call_id: call.tool_call_id, comment: { observation: process.env[key], hypothesis: null, limitation: null }, related_call_ids: [] }] }), /sensitive/);
  } finally {
    if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
  }
});

test("pipeline passes the execution-backed handoff to the presentation without rewriting it", async () => {
  const ledger = new DiagnosisLedger("diag-pipeline");
  ledger.finish(ledger.begin(descriptor, {}), empty);
  const handoff = ledger.assemble("느림", draft);
  const pipeline = new DiagnosisPipeline({ diagnose: async () => handoff }, new TemporaryDiagnosticPresenter());
  const result = await pipeline.run({ symptom: "느림", requestedBy: "test", source: "discord", receivedAt: new Date().toISOString() }, { environment: "dev", runnerMode: "mock", agentModel: "fake" });
  assert.deepEqual(result.diagnosis, handoff);
  assert.deepEqual(result.presentation, handoff);
  assert.notEqual(result.presentation, handoff);
});

test("actual LangChain loop selects a plugin, receives execution ID and annotates the runtime result", async (t) => {
  const registry = new PluginRegistry({ plugins: [{
    name: "mysql", description: "MySQL readers", domainHints: ["mysql"], tools: [{
      ...descriptor, access: { level: 0, readOnly: true }, source: "mysql", allowedEnvironments: ["dev"], timeoutMs: 1000,
      execution: { type: "source_adapter", operation: "fixture" }
    }]
  }] });
  let modelCalls = 0;
  let observedId = "";
  t.mock.method(ChatOpenAI.prototype, "_generate", async (messages: BaseMessage[], options: { tools?: { function: { name: string } }[] }) => {
    modelCalls++;
    const names = options.tools?.map(tool => tool.function.name) ?? [];
    let name: string;
    let args: Record<string, unknown>;
    if (modelCalls === 1) {
      assert.ok(names.includes("select_plugin"));
      assert.ok(!names.includes(descriptor.name));
      name = "select_plugin"; args = { pluginName: "mysql" };
    } else if (modelCalls === 2) {
      assert.ok(names.includes(descriptor.name));
      name = descriptor.name; args = {};
    } else {
      assert.equal(modelCalls, 3);
      const response = messages.find(message => message.name === descriptor.name)!;
      const payload = JSON.parse(String(response.content));
      observedId = payload.tool_call_id;
      assert.deepEqual(payload.rawResult, empty.rawResult);
      name = names.find(name => name.startsWith("extract-"))!;
      assert.ok(name);
      args = { ...draft, comments: [{ tool_call_id: observedId, comment: { observation: "조회 결과는 빈 배열이다.", hypothesis: null, limitation: "조회 범위 밖의 상태는 확인하지 않았다." }, related_call_ids: [] }] };
    }
    return { generations: [{ text: "", message: new AIMessage({ content: "", tool_calls: [{ id: `provider-${modelCalls}`, name, args, type: "tool_call" }] }) }] };
  });
  const agent = new LangChainDiagnosticAgent(registry, { execute: async () => empty }, { model: "fixture-model", apiKey: "fixture-key" });
  const handoff = await agent.diagnose({ symptom: "MySQL 확인", environment: "dev", requestedBy: "fixture", receivedAt: new Date().toISOString() });
  assert.equal(modelCalls, 3);
  assert.equal(handoff.observations.length, 1);
  assert.equal(handoff.observations[0].tool_call_id, observedId);
  assert.deepEqual(handoff.observations[0].result, empty.rawResult);
  assert.equal(handoff.observations[0].comment?.observation, "조회 결과는 빈 배열이다.");
});
