# 정본 Report V1 후단

Backend 5xx V1의 결과 상태, 7필드 리포트 조립·재검증, Discord 텍스트 투영을 가짜 저장 산출물로 검증하는 독립 모듈이다. 운영 저장·전달 호출은 연결하지 않았다.

계약 정본은 [PRD 02](../../docs/prd/current/02-agent-tool-core-and-scenario.md#결과-판정기), [PRD 03](../../docs/prd/current/03-evidence-report-security.md#report-계약), 선행 구현 범위는 [설계 기록](../../docs/design/report-downstream-v1.md)이다.

- `resolveReportStatus`는 이미 스키마·의미 검증을 마친 V1 산출물에서 양성→권한 거부→모든 필수 도구의 유효한 음성→그 외 순서로 상태를 계산한다.
- `createMonitoringReportBoundary`는 저장된 동일 Run 호출 원장과 V1 입력/출력을 다시 검증해 7필드를 결정적으로 만든다. `validate`는 필드·근거·순서를 정본 계산 결과와 대조한다. 원장이 실제 저장 본문과 같은지는 호출자가 저장소에서 검증해야 한다.
- `formatPersistedMonitoringReport`는 호출자가 완료 커밋 뒤 다시 읽어 준 리포트의 스키마를 검사하고 1,900자 이내 일반 텍스트를 반환한다. 이름은 호출 순서 계약이며 이 함수 자체에는 DB 접근이나 Discord API 호출이 없다.

테스트는 `npm test`, `npm run test:typecheck`, `npm run typecheck`, `npm run build`로 실행한다. 현재 가짜 산출물 기반이며 DB 원자성, `claimOnce`, Discord API 응답, 운영 원천 정합성을 증명하지 않는다.
