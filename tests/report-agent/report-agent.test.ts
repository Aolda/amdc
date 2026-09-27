import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import test from "node:test";
import { ReportAgentError } from "../../src/report-agent/errors.js";
import { createReportAgentPort } from "../../src/report-agent/report-agent.js";
import { REPORT_PROMPT_VERSION, REPORT_SYSTEM_PROMPT } from "../../src/report-agent/prompt.js";
import {
  deferred,
  FakeClock,
  FakeModel,
  makeContext,
  makeInput,
} from "./fakes.js";

const safeScanner = (value: string) => value.includes("TOP_SECRET");

async function expectCode(action: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) =>
    error instanceof ReportAgentError && error.code === code && !error.message.includes("TOP_SECRET"),
  );
}

test("valid model draft is wrapped by server metadata and sends only policy plus serialized input", async () => {
  const input = makeInput();
  const clock = new FakeClock();
  const model = new FakeModel();
  const port = createReportAgentPort({ model, containsSecret: safeScanner, clock }, makeContext(input));

  const output = await port.generate(input);

  assert.deepEqual(output, {
    contract_version: "report-agent-output/1.0.0",
    report_schema_version: "1.1.0",
    run_id: (input.run as { run_id: string }).run_id,
    suspected_cause: "Backend health degraded",
  });
  assert.equal(model.calls.length, 1);
  const [call] = model.calls;
  assert.equal(call.request.maxOutputTokens, 256);
  assert.equal(call.request.maxRetries, 0);
  assert.deepEqual(call.request.tools, []);
  assert.equal(call.request.messages.length, 2);
  assert.match(call.request.messages[0].content, /one causal hypothesis/);
  assert.deepEqual(JSON.parse(call.request.messages[1].content), input);
  assert.doesNotMatch(JSON.stringify(call.request), /AMDC_ENVIRONMENT|TOP_SECRET|deadlineAt|reportPromptVersion/);
  assert.equal(clock.pendingTimers, 0);
});

test("null draft remains null and non-problem status validates locally without a provider call", async () => {
  const nullModel = new FakeModel();
  nullModel.result = Promise.resolve({ suspected_cause: null });
  const input = makeInput(2);
  const output = await createReportAgentPort(
    { model: nullModel, containsSecret: safeScanner, clock: new FakeClock() }, makeContext(input),
  ).generate(input);
  assert.equal(output.suspected_cause, null);
  assert.equal(nullModel.calls.length, 1);

  for (const resultStatus of ["no_problem_detected", "insufficient_tools", "needs_permission"] as const) {
    const model = new FakeModel();
    const context = makeContext(makeInput(10 + model.calls.length), {
      resultStatus,
      reportPromptVersion: null,
    });
    const local = await createReportAgentPort(
      { model, containsSecret: safeScanner, clock: new FakeClock() }, context,
    ).generate(makeInput(10 + model.calls.length));
    assert.equal(local.suspected_cause, null);
    assert.equal(model.calls.length, 0);
  }
});

test("invalid input and invalid model draft are closed failures with no automatic retry", async () => {
  const badInput = makeInput();
  delete badInput.evidence;
  const inputModel = new FakeModel();
  await expectCode(createReportAgentPort(
    { model: inputModel, containsSecret: safeScanner, clock: new FakeClock() }, makeContext(makeInput()),
  ).generate(badInput), "invalid_report_generation");
  assert.equal(inputModel.calls.length, 0);

  const model = new FakeModel();
  model.result = Promise.resolve({ suspected_cause: "valid", extra: "forbidden" });
  await expectCode(createReportAgentPort(
    { model, containsSecret: safeScanner, clock: new FakeClock() }, makeContext(makeInput(3)),
  ).generate(makeInput(3)), "invalid_report_generation");
  assert.equal(model.calls.length, 1);
});

test("unversioned diagnostic handoff never reaches the report model", async () => {
  const input = makeInput();
  const model = new FakeModel();
  const handoff = {
    diagnosis_id: "diag-fixture", request: "Backend is slow",
    completion_reason: "insufficient_evidence", observations: [],
  };
  await expectCode(createReportAgentPort(
    { model, containsSecret: safeScanner, clock: new FakeClock() }, makeContext(input),
  ).generate(handoff), "invalid_report_generation");
  assert.equal(model.calls.length, 0);
});

test("synchronous throws and asynchronous provider rejections are sanitized", async () => {
  const sync = new FakeModel();
  sync.thrown = new Error("TOP_SECRET raw provider failure");
  await expectCode(createReportAgentPort(
    { model: sync, containsSecret: safeScanner, clock: new FakeClock() }, makeContext(makeInput(4)),
  ).generate(makeInput(4)), "provider_failure");

  const async = new FakeModel();
  async.result = Promise.reject(new Error("TOP_SECRET rejected"));
  await expectCode(createReportAgentPort(
    { model: async, containsSecret: safeScanner, clock: new FakeClock() }, makeContext(makeInput(5)),
  ).generate(makeInput(5)), "provider_failure");
  assert.equal(async.calls.length, 1);
});

test("synchronous provider throw before an earlier Run deadline remains provider_failure", async () => {
  const clock = new FakeClock();
  const model = new FakeModel();
  model.thrown = new Error("provider refused request");
  await expectCode(createReportAgentPort(
    { model, containsSecret: safeScanner, clock }, makeContext(makeInput(50), { deadlineAt: 1_000 }),
  ).generate(makeInput(50)), "provider_failure");
  assert.equal(model.calls.length, 1);
  assert.equal(clock.pendingTimers, 0);
});

test("provider rejection observed after a Run deadline but before timer delivery is run_timeout", async () => {
  const clock = new FakeClock();
  const pending = deferred<unknown>();
  const model = new FakeModel();
  model.result = pending.promise;
  const port = createReportAgentPort(
    { model, containsSecret: safeScanner, clock }, makeContext(makeInput(51), { deadlineAt: 1_000 }),
  );
  const result = port.generate(makeInput(51));
  clock.advanceWithoutFiring(1_000);
  pending.reject(new Error("provider rejected after deadline"));
  await expectCode(result, "run_timeout");
  assert.equal(clock.pendingTimers, 0);
});

test("a request-level scanner throw is a safe local failure before provider invocation", async () => {
  const model = new FakeModel();
  const scanner = (value: string) => {
    if (value.includes(REPORT_SYSTEM_PROMPT)) throw new Error("scanner internal detail");
    return false;
  };
  await expectCode(createReportAgentPort(
    { model, containsSecret: scanner, clock: new FakeClock() }, makeContext(makeInput(52)),
  ).generate(makeInput(52)), "invalid_report_generation");
  assert.equal(model.calls.length, 0);
});

test("a local non-problem result cannot cross its Run deadline during output validation", async () => {
  const clock = new FakeClock();
  const model = new FakeModel();
  const scanner = (value: string) => {
    if (value.includes('"contract_version":"report-agent-output/1.0.0"')) {
      clock.advanceWithoutFiring(1_001);
    }
    return false;
  };
  const input = makeInput(53);
  await expectCode(createReportAgentPort(
    { model, containsSecret: scanner, clock }, makeContext(input, {
      resultStatus: "no_problem_detected",
      reportPromptVersion: null,
      deadlineAt: 1_000,
    }),
  ).generate(input), "run_timeout");
  assert.equal(model.calls.length, 0);
});

test("15 second provider timeout, earlier run deadline, and late settlements clean up", async () => {
  const timeoutClock = new FakeClock();
  const timeoutDeferred = deferred<unknown>();
  const timeoutModel = new FakeModel();
  timeoutModel.result = timeoutDeferred.promise;
  const timeoutPort = createReportAgentPort(
    { model: timeoutModel, containsSecret: safeScanner, clock: timeoutClock }, makeContext(makeInput(6)),
  );
  const timedOut = timeoutPort.generate(makeInput(6));
  assert.equal(timeoutClock.pendingTimers, 1);
  timeoutClock.advance(15_000);
  await expectCode(timedOut, "provider_failure");
  assert.equal(timeoutModel.calls[0].signal.aborted, true);
  assert.equal(timeoutClock.pendingTimers, 0);
  timeoutDeferred.resolve({ suspected_cause: "late" });
  await Promise.resolve();

  const delayedClock = new FakeClock();
  const delayed = deferred<unknown>();
  const delayedModel = new FakeModel();
  delayedModel.result = delayed.promise;
  const delayedPort = createReportAgentPort(
    { model: delayedModel, containsSecret: safeScanner, clock: delayedClock }, makeContext(makeInput(60)),
  );
  const delayedResult = delayedPort.generate(makeInput(60));
  delayedClock.advance(60_000);
  await expectCode(delayedResult, "provider_failure");
  assert.equal(delayedClock.pendingTimers, 0);

  const deadlineClock = new FakeClock();
  const deadlineDeferred = deferred<unknown>();
  const deadlineModel = new FakeModel();
  deadlineModel.result = deadlineDeferred.promise;
  const deadlinePort = createReportAgentPort(
    { model: deadlineModel, containsSecret: safeScanner, clock: deadlineClock },
    makeContext(makeInput(7), { deadlineAt: 1_000 }),
  );
  const deadline = deadlinePort.generate(makeInput(7));
  deadlineClock.advance(1_000);
  await expectCode(deadline, "run_timeout");
  deadlineDeferred.reject(new Error("late rejection"));
  await Promise.resolve();
  assert.equal(deadlineClock.pendingTimers, 0);

  const equalClock = new FakeClock();
  const equalDeferred = deferred<unknown>();
  const equalModel = new FakeModel();
  equalModel.result = equalDeferred.promise;
  const equalPort = createReportAgentPort(
    { model: equalModel, containsSecret: safeScanner, clock: equalClock },
    makeContext(makeInput(70), { deadlineAt: 15_000 }),
  );
  const equalDeadline = equalPort.generate(makeInput(70));
  equalClock.advance(15_000);
  await expectCode(equalDeadline, "run_timeout");
  assert.equal(equalClock.pendingTimers, 0);
});

test("pre-abort, expiry, in-flight abort, and a late synchronous success do not escape deadline policy", async () => {
  const preAborted = new AbortController();
  preAborted.abort("TOP_SECRET parent reason");
  const preModel = new FakeModel();
  await expectCode(createReportAgentPort(
    { model: preModel, containsSecret: safeScanner, clock: new FakeClock() },
    makeContext(makeInput(8), { signal: preAborted.signal }),
  ).generate(makeInput(8)), "run_timeout");
  assert.equal(preModel.calls.length, 0);

  const expiredModel = new FakeModel();
  await expectCode(createReportAgentPort(
    { model: expiredModel, containsSecret: safeScanner, clock: new FakeClock() },
    makeContext(makeInput(9), { deadlineAt: 0 }),
  ).generate(makeInput(9)), "run_timeout");
  assert.equal(expiredModel.calls.length, 0);

  const controller = new AbortController();
  const clock = new FakeClock();
  const pending = deferred<unknown>();
  const model = new FakeModel();
  model.result = pending.promise;
  const port = createReportAgentPort(
    { model, containsSecret: safeScanner, clock }, makeContext(makeInput(11), { signal: controller.signal }),
  );
  const aborted = port.generate(makeInput(11));
  assert.equal(getEventListeners(controller.signal, "abort").length, 1);
  controller.abort("TOP_SECRET parent reason");
  await expectCode(aborted, "run_timeout");
  assert.equal(model.calls[0].signal.aborted, true);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  assert.equal(clock.pendingTimers, 0);

  const postDeadlineClock = new FakeClock();
  const instant = new FakeModel();
  const future = createReportAgentPort(
    { model: instant, containsSecret: safeScanner, clock: postDeadlineClock }, makeContext(makeInput(12)),
  ).generate(makeInput(12));
  postDeadlineClock.setNowWithoutRunningTimers(60_000);
  await expectCode(future, "provider_failure");
});

test("a port permits one call only and snapshots input and trusted context", async () => {
  const input = makeInput(13);
  const context = makeContext(input);
  const clock = new FakeClock();
  const wait = deferred<unknown>();
  const model = new FakeModel();
  model.result = wait.promise;
  const port = createReportAgentPort({ model, containsSecret: safeScanner, clock }, context);
  const originalRunId = (input.run as { run_id: string }).run_id;
  const first = port.generate(input);
  await expectCode(port.generate(input), "agent_budget_exhausted");
  (input.run as { run_id: string }).run_id = "run_0ZZZZZZZZZZZZZZZZZZZZZZZZZ";
  (context.artifacts as unknown as { evidenceId?: string }[])[0].evidenceId =
    "ev_0000000000000000000000000";
  wait.resolve({ suspected_cause: "snapshot" });
  const output = await first;
  assert.notEqual(output.run_id, (input.run as { run_id: string }).run_id);
  assert.ok(model.calls[0].request.messages[1].content.includes(originalRunId));
  assert.equal(clock.pendingTimers, 0);
});

test("ten concurrent distinct runs reverse-complete without response or Run mixing", async () => {
  const runs = Array.from({ length: 10 }, (_, index) => {
    const input = makeInput(100 + index);
    const wait = deferred<unknown>();
    const model = new FakeModel();
    model.result = wait.promise;
    return { input, wait, model, port: createReportAgentPort(
      { model, containsSecret: safeScanner, clock: new FakeClock() }, makeContext(input),
    ) };
  });
  const results = runs.map(({ input, port }) => port.generate(input));
  for (const [index, run] of Array.from(runs.entries()).reverse()) {
    run.wait.resolve({ suspected_cause: `cause-${index}` });
  }
  const outputs = await Promise.all(results);
  for (const [index, output] of outputs.entries()) {
    assert.equal(output.run_id, (runs[index].input.run as { run_id: string }).run_id);
    assert.equal(output.suspected_cause, `cause-${index}`);
    assert.equal(runs[index].model.calls.length, 1);
  }
});

test("1,000 fake runs settle with no clock timer accumulation", async () => {
  const clock = new FakeClock();
  for (let index = 0; index < 1_000; index += 1) {
    const input = makeInput(1_000 + index);
    const port = createReportAgentPort(
      { model: new FakeModel(), containsSecret: safeScanner, clock }, makeContext(input),
    );
    await port.generate(input);
  }
  assert.equal(clock.pendingTimers, 0);
});
