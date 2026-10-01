import assert from "node:assert/strict";
import { test } from "node:test";
import { toSafeErrorMetadata } from "../src/observability/safe-error-metadata.js";

test("extracts bounded provider and cause metadata without logging messages", () => {
  const cause = Object.assign(new Error("Bearer secret-token from https://provider.test"), {
    code: "ECONNRESET"
  });
  const error = Object.assign(new Error("Provider request failed with private payload"), {
    status: 502,
    code: "bad_gateway",
    type: "provider_error",
    cause
  });

  const metadata = toSafeErrorMetadata(error);

  assert.deepEqual(metadata, {
    name: "Error",
    constructorName: "Error",
    status: 502,
    code: "bad_gateway",
    type: "provider_error",
    category: "network",
    causes: [
      {
        name: "Error",
        constructorName: "Error",
        code: "ECONNRESET"
      }
    ],
    validationIssues: []
  });
  assert.doesNotMatch(JSON.stringify(metadata), /secret-token|provider\.test|private payload/);
});

test("records safe structured-output issue codes and paths", () => {
  const error = Object.assign(new Error("Invalid structured response"), {
    name: "ZodError",
    issues: [
      {
        code: "invalid_type",
        path: ["suspectedCauses", 0, "confidence"],
        message: "secret value must not be copied"
      }
    ]
  });

  const metadata = toSafeErrorMetadata(error);

  assert.equal(metadata.category, "structured_output");
  assert.deepEqual(metadata.validationIssues, [
    {
      code: "invalid_type",
      path: ["suspectedCauses", 0, "confidence"]
    }
  ]);
  assert.doesNotMatch(JSON.stringify(metadata), /secret value/);
});

test("bounds cause traversal and handles circular causes", () => {
  const error = new Error("outer") as Error & { cause?: unknown };
  const cause = new Error("inner") as Error & { cause?: unknown };
  error.cause = cause;
  cause.cause = error;

  const metadata = toSafeErrorMetadata(error);

  assert.equal(metadata.causes.length, 1);
});

test("records only allowlisted response-path identifiers and headers", () => {
  const error = Object.assign(new Error("gateway returned an internal response"), {
    status: 502,
    request_id: "req_safe-123",
    headers: new Headers({
      "x-request-id": "gateway-request-456",
      "x-litellm-call-id": "call-789",
      server: "envoy",
      via: "1.1 reverse-proxy",
      "content-type": "application/json",
      authorization: "Bearer must-not-appear",
      cookie: "session=must-not-appear",
      "x-debug-payload": "must-not-appear"
    })
  });

  const metadata = toSafeErrorMetadata(error);

  assert.equal(metadata.requestId, "req_safe-123");
  assert.deepEqual(metadata.responseHeaders, {
    "content-type": "application/json",
    server: "envoy",
    via: "1.1 reverse-proxy",
    "x-litellm-call-id": "call-789",
    "x-request-id": "gateway-request-456"
  });
  assert.doesNotMatch(
    JSON.stringify(metadata),
    /authorization|cookie|x-debug-payload|must-not-appear/
  );
});

test("propagates provider classification from a wrapped 502 cause", () => {
  const cause = Object.assign(new Error("upstream failed"), { status: 502 });
  const error = Object.assign(new Error("middleware failed"), { cause });

  assert.equal(toSafeErrorMetadata(error).category, "provider_response");
});
