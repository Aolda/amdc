# AMDC P0 구현 PRD 패키지

상태: 정본 구현 패키지
패키지 게이트 상태: ready_for_design
핵심 계약 게이트 상태: ready_for_implementation
리포트 전달 계약 게이트 상태: ready_for_implementation
라이브 소스 게이트 상태: ready_for_design
전달 상태: not_started
아키텍처 결정일: 2026-07-07
최종 검토: 2026-08-29

이 폴더의 문서만 현재 P0 개발 계약으로 사용한다. Notion, 보관 문서, 과거
배포본, 기존 MCP 설정/고정 데이터/스크립트는 의사결정 이력이나 실험 근거일 뿐
구현 기준이 아니다. 과거 자료의 아이디어는 번호가 매겨진 PRD에 반영된 뒤에만
현재 계약이 된다.

`Gate Status`는 구현 계약의 준비도이고 `Delivery Status`는 실제 코드/검증 진척이다.
API, 대기열, LangChain/도구 코어, 명시적 가짜 실행기, 증거/리포트 핵심과
리포트 에이전트/Discord 전달 계약은 구현할 수 있지만 실제 원천 매핑과
진단 정적/YAML 런타임 정합화가 미확정이므로 패키지 전체는
`ready_for_design`이다. PR #3·#5·#6의 Discord/Diagnostic 코드는 보존할
상위 시제품/전환 증거이며 현재 P0 전달 완료 증거는 아니다.

## 읽기 순서

1. [00-product-scope-and-decisions.md](00-product-scope-and-decisions.md)
   - 제품 문제, REST/Discord 진입점, 두 에이전트와 AMDC 경계, 런타임 설정, 범위
2. [01-api-run-and-storage.md](01-api-run-and-storage.md)
   - HTTP API, 인증, Run 수명주기, 대기열 접수, SQLite 계약
3. [02-agent-tool-core-and-scenario.md](02-agent-tool-core-and-scenario.md)
   - 진단 에이전트, 도구 코어, 첫 진단 시나리오와 생산자 측 인계
4. [03-evidence-report-security.md](03-evidence-report-security.md)
   - 증거, 도구 오류, 리포트 조립/검증/영속화, Discord 전달 의미
5. [04-verification-and-handoff.md](04-verification-and-handoff.md)
   - 핵심 지표, 테스트 환경, 파일 경계, 구현 순서, 롤백, 완료 조건
6. [05-live-source-integration.md](05-live-source-integration.md)
   - Prometheus/Loki/Backend 정확한 매핑과 개발 환경 간이 점검 게이트
7. [06-diagnostic-agent-tool-runtime.md](06-diagnostic-agent-tool-runtime.md)
   - 버전이 있는 리포트 인계/에이전트 예산, 소유권, 유지/조정/상위 구성요소 매핑

## 단일 기준 규칙

- 각 계약은 위 문서 중 한 곳에서만 정의한다.
- 다른 문서에서는 소유 PRD를 참조하고 필드나 수치를 독립적으로 재정의하지
  않는다.
- 계약 변경 시 소유 문서, 관련 스키마/테스트, 이 README의 게이트/전달 상태를 함께
  검토한다.
- 문서 간 충돌이 있으면 번호 순서가 아니라 해당 계약의 `Owns` 문서가 우선한다.
- 구현 진척과 과거 시제품 결과는 PRD가 아니라 별도 진행 원장에
  기록한다.

## 확정된 P0 한 줄

~~~text
Fastify REST API / Discord /diagnose 얇은 어댑터
-> SQLite Run 저장소 + 크기가 제한된 프로세스 내 대기열
-> LangChain.js 진단 에이전트
-> AMDC 소유 도구 코어
  -> 버전이 있는 Prometheus/Loki/AMDB Backend 읽기 전용 어댑터
-> 정제된 증거 + 도구 오류 + DiagnosisResult
-> 버전이 있는 ReportAgentInput
-> 도구 없는 리포트 에이전트 -> ReportNarrativeDraftV1(suspected_cause만)
-> AMDC가 만든 ReportAgentOutputV1
-> AMDC 결정적 7필드 조립 -> 검증 -> 영속화
-> REST 조회 / 영속화된 리포트 전용 Discord 형식화 및 전달
~~~

진단 에이전트는 조사 순서, 등록 도구 선택, 허용된 입력 제안과 1차 진단을
담당한다. 별도 리포트 에이전트는 PRD 06의 버전이 있고 정제된 입력만 받고
`suspected_cause` 초안 하나만 생성한다.
API, 환경 고정, 대기열/상태, 실행, 시간 초과, 예산, 정제, 증거, 저장,
정본 상태/관찰 결과, 7필드 조립, 의미 검증과 Discord
전달 순서는 AMDC가 소유한다. Discord에는 검증과 원자적 영속화가
끝난 리포트만 전달한다. MCP 서버/클라이언트/전송/탐색은 P0 실행 경로에 없다.

## 2026-08-28 R0 Report Agent·Discord 개정

- 리포트 인계는 PRD 06의 정확한 `report-agent-input/1.0.0`과
  `report-agent-output/1.0.0`만 지원하며 알 수 없는 버전은 닫힌 실패 처리한다.
- 리포트 에이전트는 도구, 원시 제공자/원천 출력, 자격 증명, 엔드포인트/질의,
  프로세스 환경과 Discord 클라이언트에 접근하지 않는다.
- 정본 리포트의 7개 필드 중 모델이 만드는 값은 `suspected_cause`뿐이다.
  나머지 필드와 상태/관찰 결과 추적은 AMDC가 결정적으로 만든다.
- 리포트 에이전트 예산은 `problem_detected` Run당 모델 호출 최대 1회,
  호출 시간 초과 15초, 자동 재시도 0이다. 가짜 구현은 같은 포트/스키마를
  사용하며 운영 대체 경로가 아니다.
- 순서는 `리포트 에이전트 -> 조립 -> 스키마/의미/비밀정보 검증 -> 원자적 영속화/completed -> 영속화된 리포트 읽기 -> Discord 형식화/전달`로 고정한다.
- 리포트 생성 실패는 `failed` Run/리포트 없음/Discord 호출 0이다. 영속화 뒤
  Discord 실패는 `completed` Run과 리포트를 유지하고 전달 이벤트로만 분리한다.
- PR #3 Discord 봇/Gateway와 PR #5·#6 진단/YAML 구현은 재경 소유 상위 구성요소로
  보존한다. R0가 수정한 제품 원천/설정/빌드 파일은 0건이다.

## 2026-07-22 검토에서 닫힌 결정

- P0 정본 API는 REST이며 운영자 CLI는 제품 범위가 아니다. 2026-08-28
  개정으로 기존 Discord `/diagnose`를 같은 애플리케이션 서비스를 사용하는 얇은
  진입/전달 어댑터로 포함했다.
- P0 런타임은 단일 Node.js/TypeScript 프로세스다. Python 서비스 분리는 없다.
- Run 환경은 서버가 고정하며 에이전트 표시 도구 입력에 포함하지 않는다.
- 정제된 증거 조회 API를 제공한다.
- Run 상태는 `queued | running | completed | failed` 네 개만 사용한다.
- 대기열 자리 예약, Run 저장, 대기열 삽입, 202 응답 순서를 정의한다.
- 도구 결과와 리포트 상태는 AMDC의 결정표와 의미 검증기가 강제한다.
- 증거, 정제된 도구 오류, 리포트는 각각 정본 JSON Schema를 가진다.
- Trigger, RAG, 웹 UI, 승인 실행, 변경 작업은 P0에 포함하지 않는다.

## 2026-07-22 검토에서 남은 결정

- 현재 저장소와 검토한 Notion에는 정확한 Prometheus 지표/레이블/PromQL,
  Loki 선택자/LogQL, Backend 상태 확인 경로/전송 내용의 정본 값이 없다.
- 이 값은 과거 MCP 문서에서 추정하지 않는다. PRD 05의 버전이 있는 원천 계약이
  확정될 때까지 실제 어댑터와 개발 환경 간이 점검은 설계 게이트에 둔다.

## 2026-08-28 R0에서 분리한 upstream 결정

- 현재 계약은 PRD 00/02의 TypeScript 정적 도구 레지스트리다. `develop@71f2069`의
  YAML 목록/런타임은 삭제하지 않는 상위/전환 구현이며 별도 합의 전
  현재 계약을 대체하지 않는다.
- 현재 시제품의 `AgentDiagnosisResult`와 `ToolObservation`에는 정본
  증거/도구 호출 ID가 없으므로 리포트 입력으로 형식 강제 변환하지 않는다. 후속 R1은
  PRD 06의 어댑터/인터페이스에서 동일 Run 정본 산출물을 결합해야 한다.
- 이슈 #4는 진단 런타임만 포함하고 최종 리포트 에이전트를 제외한다. 별도
  리포트 에이전트/Discord 구현은 이슈 #7로 추적하며 담당자는 `OstenHun`, 필요한
  Discord/진단 통합 검토자는 `worud8457`이다. 이슈 #7은 안정적인
  `tool_call_id` 근거와 성공/오류 순서를 보존하는 크기가 제한된 진단 출력 포트
  하나에만 이슈 #4 GitHub 네이티브 의존성을 연결한다. Discord 봇 접점 검토는 #7의
  `Verify` 조건이고 #4 산출물이 아니다. 정본 Run/증거/도구 호출
  영속화와 현재 코드 전용 테스트 기반은 별도 선행조건이다.

## 구현 시작 조건

- 제품/범위/런타임 설정: 00 문서에서 닫힘
- API/상태/저장/접수: 01 문서에서 닫힘
- 에이전트/도구/진단 판정 핵심: 02 문서에서 닫힘
- 증거/리포트/보안/오류/Discord 전달 의미: 03 문서에서 닫힘
- 핵심 검증/인계/롤백: 04 문서에서 닫힘
- 실제 질의/경로/파서: 05 문서에서 미확정
- ReportAgentInput/Output, 리포트 에이전트 예산, 구성요소 소유권: 06 문서에서 닫힘

따라서 핵심과 리포트 전달 계약은 `ready_for_implementation`, 패키지 전체와
실제 원천 및 진단 런타임 정합화는 `ready_for_design`이다. 핵심/리포트
구현 완료는 PRD 04, 데모 준비는 PRD 05의 간이 점검이 실제로 통과한 뒤에만 판정한다.
