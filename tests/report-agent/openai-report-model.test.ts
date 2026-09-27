import assert from "node:assert/strict";
import test from "node:test";
import { createOpenAIReportModel } from "../../src/report-agent/openai-report-model.js";

test("OpenAI adapter rejects a request that exceeds the report model contract before network use", async () => {
  const adapter = createOpenAIReportModel({ agentModel: "test-model", openaiApiKey: "test-only" });
  await assert.rejects(adapter.generate({
    messages: [{ role: "user", content: "test" }], responseSchema: {},
    maxOutputTokens: 256, maxRetries: 0, tools: ["tool"] as never[]
  }, { signal: new AbortController().signal }), /Invalid report model request/);
});

test("provider receives compatible strict structure while the full local draft schema stays unchanged", async () => {
  const originalFetch = globalThis.fetch;
  let sent: Record<string, unknown> | undefined;
  globalThis.fetch = async (input, init) => {
    sent = JSON.parse(await new Request(input, init).text()) as Record<string, unknown>;
    return new Response(JSON.stringify({ error: { message: "stubbed provider response", type: "invalid_request_error" } }), {
      status: 400, headers: { "content-type": "application/json" }
    });
  };
  const fullSchema = {
    type: "object", additionalProperties: false, required: ["suspected_cause"],
    properties: { suspected_cause: { $ref: "#/$defs/suspectedCause" } },
    $defs: { suspectedCause: { type: ["string", "null"], maxLength: 300, pattern: "^(?!.*secret).*$" } }
  };
  const before = structuredClone(fullSchema);
  try {
    const adapter = createOpenAIReportModel({ agentModel: "test-model", openaiApiKey: "test-only", openaiBaseUrl: "http://127.0.0.1:9/v1" });
    await assert.rejects(adapter.generate({
      messages: [{ role: "system", content: "Return a draft" }, { role: "user", content: "safe projection" }],
      responseSchema: fullSchema, maxOutputTokens: 256, maxRetries: 0, tools: []
    }, { signal: new AbortController().signal }));
    assert.deepEqual(fullSchema, before);
    assert.ok(sent, "provider request was intercepted");
    const body = sent as Record<string, unknown>;
    const textFormat = (body.text as { format?: { schema?: unknown; strict?: boolean } } | undefined)?.format;
    const responseFormat = (body.response_format as { json_schema?: { schema?: unknown; strict?: boolean } } | undefined)?.json_schema;
    const providerSchema = textFormat?.schema ?? responseFormat?.schema;
    assert.deepEqual(providerSchema, {
      type: "object", properties: { suspected_cause: { type: ["string", "null"] } },
      required: ["suspected_cause"], additionalProperties: false
    });
    assert.equal(textFormat?.strict ?? responseFormat?.strict, true);
    assert.doesNotMatch(JSON.stringify(body), /lookaround|\(\?!|suspectedCause|\$defs/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
