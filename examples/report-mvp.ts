import { randomUUID } from "node:crypto";
import { DiagnosisLedger, type DiagnosisHandoff } from "../src/report/diagnosis-handoff.js";
import type { AgentVisibleToolDescriptor } from "../src/tools/types.js";

const lockWaits: AgentVisibleToolDescriptor = {
  name: "mysql_get_lock_waits", pluginName: "mysql", description: "Synthetic lock wait lookup",
  readOnly: true, inputSchema: { type: "object", additionalProperties: false },
};
const transactions: AgentVisibleToolDescriptor = {
  name: "mysql_get_all_transactions", pluginName: "mysql", description: "Synthetic transaction lookup",
  readOnly: true, inputSchema: { type: "object", additionalProperties: false },
};

/** Synthetic PR14-shaped ledger; it never opens a provider connection. */
export function reportMvpFixture(diagnosisId = `diag-${randomUUID()}`): DiagnosisHandoff {
  const ledger = new DiagnosisLedger(diagnosisId);
  const observedAt = "2026-09-27T00:00:00.000Z";
  const first = ledger.begin(lockWaits, {});
  ledger.finish(first, { ok: true, rawResult: {
    toolName: lockWaits.name, pluginName: "mysql", source: "mysql", collectedAt: observedAt,
    transport: "mysql", appliedFilters: {}, limit: 100,
    rows: [{ waitSeconds: 12 }], returnedRows: 1, truncated: false,
  } });
  const second = ledger.begin(transactions, {});
  ledger.finish(second, { ok: false, error: {
    toolName: transactions.name, pluginName: "mysql", code: "source_permission_denied",
    message: "조회 권한이 없어 결과를 받을 수 없습니다.", occurredAt: observedAt,
  } });
  return ledger.assemble("데이터베이스 지연을 조사해주세요.", {
    completion_reason: "investigation_complete",
    comments: [{
      tool_call_id: first.tool_call_id,
      comment: {
        observation: "잠금 대기 한 건이 관찰되었습니다.",
        hypothesis: "잠금 경합이 지연에 기여했을 가능성이 있습니다.",
        limitation: "전체 트랜잭션 조회 권한이 없어 영향 범위를 확인하지 못했습니다.",
      },
      related_call_ids: [second.tool_call_id],
    }],
  });
}
