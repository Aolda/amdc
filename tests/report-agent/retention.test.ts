import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { getEventListeners } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ReportAgentError } from "../../src/report-agent/errors.js";
import { createReportAgentPort } from "../../src/report-agent/report-agent.js";
import { deferred, FakeClock, makeContext, makeInput } from "./fakes.js";

/** Keep Run-local strong references outside the GC assertion's stack frame. */
async function timeOutRun(
  providerResult: Promise<unknown>,
  clock: FakeClock,
  scan: (value: string) => boolean,
): Promise<WeakRef<AbortSignal>> {
  const input = makeInput(4_400);
  const context = makeContext(input);
  const signal = new WeakRef(context.signal);
  let calls = 0;
  const port = createReportAgentPort({
    model: {
      generate() {
        calls += 1;
        return providerResult;
      },
    },
    containsSecret: scan,
    clock,
  }, context);
  const result = port.generate(input);
  clock.advance(15_000);
  await assert.rejects(result, (error: unknown) =>
    error instanceof ReportAgentError && error.code === "provider_failure",
  );
  assert.equal(calls, 1);
  assert.equal(clock.pendingTimers, 0);
  assert.equal(getEventListeners(context.signal, "abort").length, 0);
  return signal;
}

async function verifyTimeoutRetention(): Promise<void> {
  const gc = global.gc;
  assert.equal(typeof gc, "function", "Run the report tests with node --expose-gc.");
  if (!gc) throw new Error("GC must be exposed for the retention regression.");

  // Retaining this deferred Promise reproduces an adapter that ignores cancellation.
  // The fake deliberately does not retain the request or either AbortSignal.
  const provider = deferred<unknown>();
  const clock = new FakeClock();
  let scans = 0;
  const signal = await timeOutRun(provider.promise, clock, () => {
    scans += 1;
    return false;
  });
  const scansAtTimeout = scans;
  let collected = false;
  for (let pass = 0; pass < 20; pass += 1) {
    // WeakRef.deref keeps its target alive through the current job; yield first.
    await new Promise<void>((resolve) => setImmediate(resolve));
    gc();
    if (signal.deref() === undefined) {
      collected = true;
      break;
    }
  }
  assert.equal(collected, true, "The pending provider must not retain the timed-out Run signal.");

  provider.resolve({ suspected_cause: "late output must never be validated" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(scans, scansAtTimeout, "Late output must be discarded before validation.");
  assert.equal(clock.pendingTimers, 0);
}

// Node's isolated test child may drop --expose-gc with the tsx loader. A dedicated
// process keeps GC enabled without changing isolation or flags for other tests.
if (process.argv.includes("--retention-child")) {
  await verifyTimeoutRetention();
} else {
  test("timeout releases Run state while the rooted provider Promise remains unresolved", async () => {
    await new Promise<void>((resolve, reject) => {
      execFile(process.execPath, [
        "--expose-gc", "--import", "tsx", fileURLToPath(import.meta.url), "--retention-child",
      ], { timeout: 10_000, encoding: "utf8" }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Retention subprocess failed:\n${stdout}${stderr}`, { cause: error }));
        } else {
          resolve();
        }
      });
    });
  });
}
