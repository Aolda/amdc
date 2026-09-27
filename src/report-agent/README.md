# Report Agent 소비자 포트

PRD 06의 가짜 입력 기반 선행 개발 모듈이다. 검증된 소비자 입력에서 원인 초안만 생성하며, 호출 예산·취소·출력을 검증한다. 진단·저장·최종 리포트·Discord에는 아직 연결하지 않는다.

## 계약과 사용 경계

계약 정본은 [PRD 06](../../docs/prd/current/06-diagnostic-agent-tool-runtime.md), 이번 범위는 [9월 22일 후속 합의](../../docs/design/report-agent-preparation.md#2026-09-22-후속-합의-선행-개발과-템플릿-논의-분리)다.

- `createReportAgentPort(dependencies, context)`는 Run 하나에 속한 일회용 `ReportAgentPort`를 만든다. `generate(input)`은 `unknown` 입력을 검증하고 `ReportAgentOutputV1`을 반환한다.
- `createReportValidators({ containsSecret })`는 입력·모델 초안·외부 포트 출력 검증기를 제공한다. 미래 조정기는 가짜 포트를 포함해 반환된 출력도 `output(value, expectedRunId)`으로 다시 검사해야 한다.
- `createSecretDetector(knownSecrets)`는 호출자가 전달한 적재 비밀정보와 정해진 자격 증명 표식을 검사한다. 이 모듈은 환경 변수나 자격 증명 파일을 읽지 않는다. 실제 통합에서는 적재 비밀정보를 포함한 AMDC 검사기를 주입해야 한다.
- 출력의 모델 소유 필드는 `suspected_cause` 하나이며 `null` 또는 정규화한 한 줄 1–300자다. 버전과 Run ID는 포트가 붙인다. 최종 리포트의 `가능성: ` 접두사는 여기서 붙이지 않는다.

## 호출자가 제공할 신뢰 문맥

`ReportRunContext`에는 영속화된 `runId`, `diagnosticReferenceTime`, 같은 Run의 전체 산출물 호출 순서(`artifacts`), AMDC가 이미 계산한 `resultStatus`, 커밋된 `reportPromptVersion`, Run의 `deadlineAt`과 취소 `signal`을 넣는다.

`artifacts`의 항목은 `{ toolCallId, evidenceId? }`다. 증거에는 `evidenceId`가 있고 도구 오류에는 없다. 검증기는 입력 산출물의 ID·순서·근거·시각을 이 문맥과 대조한다. 이 목록은 저장된 본문의 동일성을 증명하지 않는다. 호출자는 이미 검증·커밋된 본문을 저장소에서 읽어야 하며, 요청이나 모델이 이 신뢰 문맥을 만들게 하면 안 된다.

이 모듈은 생산자의 문제 판정·임계값을 다시 계산하지 않는다. 기존 Evidence·Tool Error 스키마를 재사용하며 MySQL 판정이나 신규 생산자 오류 enum을 정의하지 않는다.
기존 Backend 5xx V1의 결과 판정, 결정적 7필드 조립·재검증과 Discord 텍스트
투영은 별도 [reports 모듈](../reports/README.md)이 담당한다.

2026-09-25 확인한 미병합 PR #14의 `DiagnosisHandoff`는 별도 생산자 후보이다. 그 안의
`success | error`, `completion_reason`, `diagnosis_id:call-N`, 원천 `result`를
`ReportAgentInputV1`로 직접 받지 않는다. 동일 Run의 영속화된 호출·증거/오류와
명시적으로 대응하고 정제·크기·완료 범위를 검증한 뒤에만 후속 연결을 설계한다.
현재 테스트는 생산자 모양의 직접 입력을 거부하고, V1의 성공·권한 오류·성공
순서를 신뢰 원장에 대조한다. 상세 근거와 남은 결정은
[설계 준비 문서](../../docs/design/report-agent-preparation.md#2026-09-25-생산자-인계-확인과-report-경계)에 있다.

`problem_detected`이면 `REPORT_PROMPT_VERSION`과 같은 저장된 버전이 필요하다. 나머지 기존 상태는 `reportPromptVersion=null`이어야 하며, 입력 검증 후 모델 호출 없이 원인 `null`을 반환한다. prompt binding 트랜잭션과 Run별 포트 생성 권한은 미래 조정기의 책임이다. 같은 포트를 두 번 호출하면 실패하며, 별도 포트를 다시 만들어 재시도하는 전역 경로는 제공하지 않는다.

## 주입 모델과 수명주기

`ReportModelAdapter.generate(request, { signal })`의 반환값은 파싱된 원인 초안이다. 어댑터에는 분리된 system/user 메시지, 초안 JSON Schema, `maxOutputTokens=256`, `maxRetries=0`, 빈 도구 목록만 전달한다. Run의 저장 문맥, 환경 설정과 비밀정보 목록은 전달하지 않는다.

어댑터는 신뢰하는 애플리케이션 코드다. 한 번의 제공자 요청에서 토큰 상한과 native structured output을 적용하고, 도구·자동 재시도 없이 `signal`을 준수하며 자체 listener를 정리해야 한다. 실제 제공자 어댑터·SDK 연결은 이번 범위에 없다. 가짜 모델은 [테스트 fixture](../../tests/report-agent/fakes.ts)에만 있다. 전달한 256토큰 설정은 테스트하지만 실제 제공자의 토큰 집행을 검증했다고 주장하지 않는다.

포트는 Run 기한과 15초 제공자 기한 중 먼저 도달하는 기한을 적용한다. 성공·실패·취소 때 타이머와 부모 abort listener를 정리하고, 늦게 도착한 완료·거부를 무시한다. 끝나지 않는 제공자 Promise의 완료 처리기에는 정리 후 Run 상태가 남지 않는다. 어댑터가 취소를 무시하면 외부 작업 자체를 강제로 종료할 수 없으므로 실제 연결 전 취소 준수 검증이 필요하다.

오류는 기존 소비자 경계 코드만 담은 `ReportAgentError`다. 원시 예외·입력·제공자 응답을 오류에 붙이거나 기록하지 않는다. 프롬프트 지시와 스키마 검증은 자유형 원인 문장의 사실성이나 인과관계를 입증하지 않는다.

## 로컬 검증

프로젝트 루트에서 실행한다. Node.js와 설치된 개발 의존성만 사용하며 실제 인증정보는 필요 없다.

```powershell
npm test
npm run test:typecheck
npm run typecheck
npm run build
```

테스트는 리포트 모듈만 대상으로 한다. 유효/null, 엄격한 키·버전·길이·시각·Run/근거·비밀정보, 제공자 실패·기한·늦은 완료, 반복 호출, 10개 동시 Run의 역순 완료와 정리를 검사한다. 1,000개 가짜 요청의 자원 정리 검사는 전체 시스템 RSS 부하 기준이나 운영 통합 검증을 대체하지 않는다.

컴파일된 모듈도 저장소 루트의 `schemas/` 파일을 로컬에서 읽는다. 배포용 독립 패키징에는 이 파일들의 포함 검증이 필요하며, 현재 Docker 구성은 이번 변경 대상이 아니다.

운영 진입점에 import하지 않았으므로 모듈·세 소비자 스키마·전용 테스트·패키지 변경만 되돌려 롤백할 수 있다. DB migration, 진단/YAML 수정, 실제 진단 변환, 리포트 조립과 Discord 전달은 포함하지 않는다.
