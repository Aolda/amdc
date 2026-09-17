import test from "node:test";
import assert from "node:assert/strict";
import { localToolDetails } from "../src/observability/local-tool-details.js";
import type { ToolRuntimeResult } from "../src/tools/types.js";

test("Prometheus tracing records inputs and counts without raw labels or samples", () => {
  const previous = process.env.AMDC_LOCAL_TOOL_TRACE;
  process.env.AMDC_LOCAL_TOOL_TRACE = "true";
  try {
    const result = (data: unknown): ToolRuntimeResult => ({ok:true,rawResult:{toolName:"prometheus_get_metric_range",pluginName:"prometheus",source:"prometheus",transport:"http",collectedAt:new Date().toISOString(),response:{statusCode:200,contentType:"application/json",body:JSON.stringify({status:"success",data})}}});
    const args={metricName:"up",job:"mysql",start:"2026-09-17T01:00:00Z",end:"2026-09-17T01:10:00Z",stepSeconds:60};
    const details=localToolDetails("dev",args,result({resultType:"matrix",result:[{metric:{private:"not-for-log"},values:[[1,"sensitive-value"],[2,"another-value"]]}]}));
    assert.deepEqual(details.localDetails?.args,args);
    assert.equal(details.localDetails?.seriesCount,1);
    assert.equal(details.localDetails?.pointCount,2);
    assert.doesNotMatch(JSON.stringify(details),/not-for-log|sensitive-value|another-value/);
    assert.equal(localToolDetails("dev",args,result({resultType:"vector",result:[]})).localDetails?.seriesCount,0);
    assert.equal(localToolDetails("dev",args,result([{job:"hidden"}])).localDetails?.itemCount,1);
    assert.deepEqual(localToolDetails("prod",args,result({})),{});
  } finally { if(previous===undefined)delete process.env.AMDC_LOCAL_TOOL_TRACE;else process.env.AMDC_LOCAL_TOOL_TRACE=previous; }
});

test("local tracing is opt-in, dev-only, bounded and excludes raw fields", () => {
  const previous = process.env.AMDC_LOCAL_TOOL_TRACE;
  try {
    delete process.env.AMDC_LOCAL_TOOL_TRACE;
    assert.deepEqual(localToolDetails("dev", { connectionId: "1" }), {});
    process.env.AMDC_LOCAL_TOOL_TRACE = "true";
    assert.deepEqual(localToolDetails("prod", { connectionId: "1" }), {});
    const details = localToolDetails("dev", { connectionId: "1", schema: "x".repeat(200), password: "secret", sql: "SELECT secret" });
    assert.equal(details.localDetails?.args.schema, "x".repeat(128));
    assert.equal(details.localDetails?.args.connectionId, "1");
    assert.doesNotMatch(JSON.stringify(details), /secret|password|SELECT/);
  } finally {
    if (previous === undefined) delete process.env.AMDC_LOCAL_TOOL_TRACE;
    else process.env.AMDC_LOCAL_TOOL_TRACE = previous;
  }
});
