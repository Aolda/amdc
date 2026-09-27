# AMDC 현재 구조와 목표 아키텍처

사용자가 제공한 현재 구조와 기존 P0 목표를 구분한다. 현재는 Discord·진단 Agent·Tool Core 중심이며 Report Agent는 연동 예정이다. 진단 기록 양식과 기존 인계 계약의 차이를 닫는 것이 다음 설계 과제다.

기준일: 2026-09-22
상태: 현재 구조는 사용자 제공 근거, P0 흐름은 목표 계약
계약 진입점: [P0 PRD](docs/prd/current/README.md)

## 현재 구조

아래는 사용자가 2026-09-22 제공한 「AMDC 현재 구조」 그림의 전사다.
실선은 그림에서 현재 구현으로 표시한 경로, 점선은 테스트·예정 경로다.
이 표시는 배포 상태나 로컬 checkout의 실행 검증을 뜻하지 않는다.

~~~mermaid
flowchart TB
  D[Discord] -->|요청| A[진단 Agent · LangChain]
  A -->|임시 결과 응답| D
  K["도메인 지식 DB · PostgreSQL · 지식 카드 8개"] -. 테스트 주입 .-> A
  A <--> T["Tool Core · YAML 정의 · 입력 검증 · 읽기 전용 실행"]
  T <--> S[system]
  T <--> P[prometheus]
  T <--> M[mysql]
  T <--> X[proxysql]
  S <-->|HTTP| B[AMDB Backend]
  P <-->|HTTP API| PM[Prometheus]
  M <-->|SQL| MY[MySQL]
  X <-->|SQL| PX[ProxySQL Admin]
  A -. 조회 결과 · 의심 지점 .-> R[Report Agent · 향후 연동]
~~~

- 각 플러그인은 선택된 플러그인의 도구만 공개하는 구조로 제시됐다.
- 지식 DB는 기본 진단 경로에 연결되지 않았고 테스트 주입 단계다.
- SQL 연결은 Tool Core가 소유한 읽기 전용 도구 경로다. 에이전트가 임의 SQL을 실행한다는 뜻이 아니다.
- 그림의 진단 출력은 최종 리포트가 아니다. 기록 필드는 [PRD 06의 최신 입력 자료](docs/prd/current/06-diagnostic-agent-tool-runtime.md#2026-09-22-진단-기록-입력-자료)가 소유한다.
- 그림에 REST·Loki·Run 저장소가 없다고 기존 목표에서 제거된 것으로 판단하지 않는다.

## 로컬 코드와 근거의 범위

이번 읽기 기준은 로컬 HEAD `25e3acd`이며 원격 최신 코드·배포는 검증하지 않았다.
`src/agent/types.ts`의 `AgentDiagnosisResult`는 여전히 `symptom`, `toolErrors`,
`preliminaryFindings` 등을 사용한다. `src/tools/types.ts`의 `ToolObservation`에는
첨부 양식의 `seq`, `tool_call_id`, `result.rows`, `comment`가 없다.
따라서 최신 그림과 로컬 구현을 동일 상태로 표시하지 않는다.

## 기존 P0 목표

아래는 현재 동작 설명이 아니라 번호 PRD가 정의한 목표 흐름이다.

~~~text
REST API / Discord 얇은 어댑터
-> Run 저장소 + 제한된 대기열
-> LangChain Diagnostic Agent -> AMDC Tool Core
-> 정제된 Evidence / Tool Error + DiagnosisResult
-> 검증된 ReportAgentInput
-> 도구 없는 Report Agent: suspected_cause 초안
-> AMDC 결정적 조립 -> 검증 -> 원자적 영속화
-> REST 조회 / 영속화된 리포트의 Discord 전달
~~~

현재 P0의 정적 3도구·Backend 5xx 시나리오와 최신 YAML·MySQL·ProxySQL 구조의
차이는 [설계 준비안](docs/design/report-agent-preparation.md#기존-계약과의-차이)에서 다룬다.
그림만으로 정적 레지스트리, 저장소, 시나리오 또는 리포트 스키마를 교체하지 않는다.

## 책임과 신뢰 경계

- 진단 Agent: 조회 도구 선택과 결과 해석, 관찰·가설·한계 작성.
- Tool Core: 등록된 도구의 입력/환경 검증, 읽기 전용 실행, 예산·시간 초과·정제.
- Report Agent 목표: 검증된 입력으로 제한된 원인 초안 작성. 도구 실행과 추가 조사 요청은 없음.
- AMDC 목표: 상관관계, 정본 상태, 검증, 저장, 최종 리포트 조립과 전달 순서.
- 결과 문자열·모델 코멘트·지식 카드는 데이터이며 그 안의 지시문은 실행 지침이 아니다.
- 원시 응답·질의·인증정보를 그대로 리포트 입력이나 저장 기록으로 옮기지 않는다.

정확한 계약과 예산은 [PRD 02](docs/prd/current/02-agent-tool-core-and-scenario.md),
[PRD 03](docs/prd/current/03-evidence-report-security.md),
[PRD 06](docs/prd/current/06-diagnostic-agent-tool-runtime.md)이 소유한다.
