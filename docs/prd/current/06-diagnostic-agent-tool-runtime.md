# PRD 06. 상위 진단 구성요소 및 리포트 에이전트 인계

진단과 리포트의 인계·소유권을 정의한다. 정본 흐름에는 계약 준수가 검증된 진단 포트만 연결하며, mock 연결 확인은 별도 고정 안내로 끝낸다. 기존 시제품의 미준수와 최신 리뷰 보정은 팀 검토 대상이다.

상태: 현재 개정본
최종 검토: 2026-09-11 (리뷰 보정안, 팀 승인 대기)
리포트 핸드오프 게이트 상태: ready_for_implementation
진단 런타임 정합화 게이트 상태: ready_for_design
소유: 버전이 있는 진단-리포트 인계, 리포트 에이전트 예산, 구성요소 소유권,
유지/조정/상위 구성요소 매핑

이 문서는 정본 도구 실행 정책, 정본 7필드 리포트 의미, 저장소 트랜잭션,
검증 임계값을 소유하지 않는다. PRD 00/02가 현재 도구 정책을, PRD 03이
리포트/전달 의미를, PRD 04가 실행 가능한 검증을 소유한다.

## 게이트 검토

[핵심 검토]
Gate Status: ready_for_implementation

`develop@71f2069`은 Discord Gateway/Slash Command, 진단 에이전트 골격, YAML
목록/런타임과 빌드 패키징이 있음을 증명한다. 그러나 Run 저장소, 정본
증거/도구 호출 ID, 리포트 에이전트, 7필드 리포트 영속화와 자동화 테스트
명령이 없다. 현재 `AgentDiagnosisResult`와 `ToolObservation`을 정본 리포트
입력으로 이름만 바꾸면 관찰 결과 추적이 끊긴다.

병목은 재경의 상위 진단 파이프라인과 동훈의 리포트 소유권 사이에
버전이 있는 경계가 없다는 것이다. 아래 인계는 리포트 작업 구현을 시작할 만큼
닫혔지만 패키지/실제 원천과 정적/YAML 진단 런타임 정합화 게이트는 계속
`ready_for_design`이다. R0는 상위 구현을 삭제·재설계하지 않는다.

[트레이드오프 분석]

경로 A: 리포트 에이전트가 7필드 리포트와 Discord 문장을 직접 생성·전송한다.

- 데모 경로가 가장 짧다.
- 모델이 상태/관찰 결과/조치를 만들고 리포트와 채널 표현이 결합된다.
- Discord 실패가 진단 결과를 오염시킨다.

경로 B: 버전이 있고 정제된 인계 -> 크기가 제한된 리포트 에이전트 원인 초안 -> AMDC
조립/검증/영속화 -> Discord 어댑터. 선택함.

- 모델은 가설 하나만 만들고 실행/전달 권한을 얻지 않는다.
- REST와 Discord가 같은 영속화된 리포트를 재사용한다.
- 리포트 생성/저장/Discord 실패가 분리된다.

경로 C: 현재 `AgentDiagnosisResult`를 임시 표시 계층에서 바로 변환한다.

- 향후 변경량은 작다.
- 정본 증거/도구 호출 참조가 없어 동일 Run 추적과 PRD 02 우선순위를
  증명할 수 없다.

[실행 가능한 다음 단계]

R1은 진단/YAML 내부를 바꾸지 않는 하위 어댑터로 검증된 진단
DTO와 영속화된 동일 Run 증거/오류를 결합한다. R2는 가짜 구현 우선의 도구 없는 리포트
에이전트, R3-R5는 결정적 리포트/영속화/Discord 접점을 구현한다. R0 인계는
PRD와 GitHub 추적기/문서 전용 PR만 바꾸며 제품 원천/설정/빌드/스키마/잠금 파일을
수정하지 않는다.

## 규범적 우선순위 및 R0 경계

- PRD 00/02의 TypeScript 정적 도구 레지스트리가 현재 P0 실행 계약이다.
- PR #5/#6의 YAML 목록/런타임과 전체 도구 노출은 삭제하지 않는
  상위/전환 구현이다. 병합 사실만으로 현재 계약을 대체하지 않는다.
- 이 문서는 진단 실행의 하위 경계에서 시작한다. 검증된 호환
  DTO와 정본 영속화 산출물만 받는다.
- PRD 03만 정본 리포트 필드, 조립/검증/영속화 순서와 Discord
  실패 의미를 소유한다. PRD 04만 실행 가능한 검증을 소유한다.
- Trigger, 실제 원천 매핑, 진단 피드백 순환, 변경 작업과 자동 Discord
  재시도는 R0/P0 밖이다.

## 컴포넌트 소유권

| 컴포넌트/결정 | 소유자 | R0 규칙 |
|---|---|---|
| Discord 봇/Gateway, Slash Command, VM 연결 | 재경 상위 구성요소 | 보존. 재구현/삭제 금지 |
| 진단 에이전트, 파이프라인 팩터리, YAML 런타임 내부 | 재경 상위 구성요소 | 보존. 리포트 측에서 가져오거나 재설계하지 않음 |
| 순서와 참조를 보존하는 진단 출력 포트 | 재경 상위 구성요소 / 이슈 #4 | 향후 선행조건. 안정적인 도구 호출 근거, 리포트 필드 없음 |
| 진단 호환 어댑터 | 동훈 리포트 경계 | 향후 접점. 검증하며 형식 강제 변환 금지 |
| ReportAgentInput/Output 및 리포트 에이전트 | 동훈 | 정확한 버전, 도구 없음, 제한된 모델 호출 |
| 리포트 조립기/검증기/영속화 | 동훈 및 AMDC 권한 | 모델은 결정적 필드를 소유하지 않음 |
| 영속화된 리포트의 Discord 포맷/전달 접점 | 동훈 확장, 재경 통합 검토 | 접점 조정. Gateway 소유권 보존 |
| 정적/YAML 런타임 정합화 및 실제 어댑터 | 공동 상위 구성요소 | 별도 결정. R0 범위 아님 |

## 기존 구현 재사용 매핑

기준: `develop@71f2069` 및 병합된 PR #3 (`80abd2f`), PR #5 (`dad139c`),
PR #6 (`71f2069`). 병합/빌드 사실은 시제품 증거이며 리포트 완료를 뜻하지 않는다.

| 기존 컴포넌트 | 증거 | 분류 | 향후 작업 규칙 |
|---|---|---|---|
| Discord 봇/Gateway 및 `/diagnose` | `src/adapters/discord/bot.ts`, PR #3 | **유지 · 재경 상위 구성요소** | 진입/출력을 유지하고 영속화된 리포트 전달만 연결 |
| 진단 에이전트 및 파이프라인 | `src/app/diagnosis-pipeline.ts`, `src/agent/langchain-diagnostic-agent.ts`, PR #5 | **유지 · 재경 상위 구성요소** | 현 구현을 그대로 호출하지 않음. 상위 담당자의 PRD 02 준수 검증 후 포트를 주입하고 호환 어댑터로 출력 검증 |
| YAML 목록/런타임 및 상태 확인 어댑터 | `src/tools/catalog-loader.ts`, `src/tools/yaml-tool-runtime.ts`, PR #5/#6 | **상위/전환 구현** | 보존. 정적/YAML 결정은 별도로 유지 |
| 임시 진단 표시 계층 | `src/report/temporary-diagnostic-presenter.ts` | **조정 · 동훈 접점** | 과도기 전용. 정본 리포트 아님 |
| Discord 포매터 | `src/adapters/discord/format-report.ts` | **조정 · 동훈 접점** | 영속화된 7필드 리포트 입력만 사용 |
| 패키지/빌드/목록 복사 | `package.json`, `scripts/copy-tool-catalogs.mjs`, Dockerfile | **유지 + 검증 공백** | 보존. 리포트 작업이 패키징을 방해하지 않음 |

R1이 숨겨서는 안 되는 호환성 사실:

- 현재 `AgentDiagnosisResult`에는 `run_id`, `evidence_id`, `tool_call_id`가 없다;
- 현재 `ToolObservation`은 PRD 03 canonical Evidence가 아니다;
- 현재 관찰 결과와 도구 오류가 분리되어 호출이 섞인 순서가 유실된다.
- 현재 에이전트는 플러그인이 선택한 도구가 아니라 `registry.listAllTools()`를 노출한다.
- 현재 `LangChainDiagnosticAgent`는 `buildSystemPrompt(input.environment)`로 환경 값을 모델에 노출한다. 출력 어댑터의 정제만으로 이미 전송된 입력을 회수할 수 없으므로 현재 `runDiagnosis()`를 정본 흐름에서 직접 재사용하지 않는다.
- 현재 `MockDiagnosticRunner`는 `diagnosis` 없이 임시 `presentation`만 반환하고 그 안에 환경 값도 포함한다. 이를 정본 인계나 사용자 안내의 원문으로 사용하지 않는다.
- 현재 임시 표시 계층은 모든 도구 오류가 양성 관찰 결과를 덮어쓰도록 한다.
- 현재 포매터는 임시 4필드 형식을 사용하며 접미사가 명목상 1,900자
  잘라내기 범위를 초과할 수 있다.
- 현재 봇은 임시 표시 내용을 직접 보내며 리포트 영속화 경계가 없다.
- 현재 봇 기본 로그에는 설정된 길드 ID가 포함되어 목표 로깅 경계를 위반한다.
  향후 담당자가 검토한 어댑터 변경 전까지 이를 유지한다.
- 현재 패키지에는 자동화된 `test` 스크립트가 없다.

이는 향후 어댑터/호출 지점 공백이며 R0에서 제품 코드를 수정할 권한이 아니다.
이슈 #4는 가장 작은 상위 선행조건을 소유한다. 즉 각 관찰 결과/오류에 서버가 발급한
안정적인 `tool_call_id`를 붙이고 예비 발견/원인 근거에 그 ID를 사용하는 크기가 제한된
순서 보존 출력 포트다. 최종 리포트 필드나 정본 증거 영속화는 추가하지 않는다.
#7 어댑터는 영속화된 동일 Run 산출물에 대해서만 해당 ID를 해석할 수 있으며, 텍스트 매칭이나
순서 재구성은 금지한다.

### 향후 접점 편집 경계

동훈이 작성하고 재경이 통합 검토할 향후 접점은 다음으로 제한한다.

1. 새 `src/app/report-flow.ts`의 `runReportFlow()`가 정본 애플리케이션
   접수/조정기에 먼저 진입해 대기열/Run 불변조건을 검증하고 영속화된 Run
   문맥을 얻는다. 그 뒤 PRD 02의 입력·프롬프트·도구 정책 준수가 검증된
   `DiagnosticAgentPort`를 의존성으로 받아 호출하고, 반환된 진단 DTO를 신뢰하지 않는
   입력으로 호환 어댑터에 넘긴다. 현재 `runDiagnosis()`나 기존 동명 TypeScript
   인터페이스와의 형식 일치만으로 준수를 인정하지 않는다. 임시 `presentation`은
   정본 입력으로 사용하지 않는다.
2. `src/adapters/discord/bot.ts`의 `handleDiagnoseCommand()`에서
   `runDiagnosis(...) -> formatDiagnosticPresentation(result.presentation) -> editReply`
   호출 사슬을 `langchain` 모드에서만 `runReportFlow(...) -> persisted Report projection -> editReply`로 바꾼다. 명시적 로컬 `mock`은 아래 연결 확인 분기로 먼저 종료한다.
3. Gateway 로그인/등록, 명령 스키마, 입력 추출, 서버 소유 환경과
   `deferReply`는 재경 상위 구성요소로 유지한다. 안전 오류 내용/정규화도
   재사용하되 `handleDiagnoseCommand()` 오류 경계는 전달 단계를 구분하는 최소
   변경을 허용한다. 리포트 전달 소유권 확보 전 접수/생성 실패만 고정
   안전 오류 응답을 한 번 확보할 수 있다. 리포트 전달 소유권이 소비된 뒤의
   시간 초과/네트워크/거부 예외는 `failed|unconfirmed` 전달 이벤트로 종결하며
   두 번째 `editReply`를 호출하는 범용 예외 처리로 전파하지 않는다.

`src/app/diagnosis-pipeline.ts`, `src/agent/**`, 도구 선택/실행, YAML 목록/런타임,
목록 패키징과 원천 어댑터 변경은 이 접점 권한에 포함되지 않는다.
임시 표시 계층 제거는 검증된 전환 뒤 별도 결정이다.

### 진단 포트 연결 전제조건

상위 담당자가 PRD 02의 모델 가시 메시지 환경값 금지, 정적 도구 정책과 prompt
version 고정을 검증한 뒤 운영 진단 포트를 연결한다. 현재 `runDiagnosis()`를 호출한 뒤
출력만 정제하는 우회는 금지한다. 그 전에는 명시적 테스트 의존성으로 주입한 가짜
진단 포트와 가짜 도구만으로 R1 인계를 검증하며, 운영 모드의 누락·미검증 포트는
시작 시 거부한다. 실제 포트 호출 실패를 가짜 구현으로 자동 대체하지 않는다.

이 선행조건의 진단 내부 수정은 재경 상위 작업으로 검토한다. R0나 리포트 측
R1-R5의 파일 권한을 확장하지 않고, #4의 출력 포트만 완료됐다는 이유로 충족됐다고
간주하지 않는다. 정적/YAML 결정도 여전히 별도다.

### mock 연결 확인 경계

명시적 로컬 `AMDC_DIAGNOSTIC_RUNNER=mock`은 기존 연결 확인 목적을 유지한다. HTTP·저장소의 시작 금지와 모드별 필수 설정은 PRD 00이 소유하며, 이 분기는 REST에서 호출되지 않는다.
`handleDiagnoseCommand()`는 설정/입력 검증과 기존 `deferReply` 뒤, `runReportFlow()`
진입 전에 이 분기를 판정하고 다음 고정 안내를 `editReply`로 한 번만 보낸다.

~~~text
[MOCK 연결 확인] Discord 연결이 확인되었습니다. 진단을 실행하거나 리포트를 저장하지 않았습니다.
~~~

`runDiagnosis()`, `MockDiagnosticRunner`, 진단/리포트 에이전트, 원천 호출과 정본
Run/Evidence/Report 쓰기는 모두 0회다. `presentation`의 증상·환경·원시 필드를
복사하지 않고 `diagnosis`가 있다고 가정하지 않는다. 안내 전송 실패 시 두 번째
`editReply`를 호출하지 않는다. 이 분기는 P0 진단 결과나 `completed` Run이 아니며
PRD 03의 리포트 전달 이벤트로 기록하지 않는다. 정본 리포트용 포매터와 분리된
연결 안내이고, 테스트는 가짜 Discord를 사용한다. 실제 Discord 연결 확인은 별도
승인된 로컬 확인에서만 실행한다. 기존 mock/임시 표시 모듈은 삭제하지 않는다.

mock에서 정본 인계까지 검증하는 대안은 기존 연결 확인의 범위를 넓힌다. 정본
종단 간 테스트는 PRD 02/04의 주입된 가짜 진단·도구·리포트 포트로 따로 검증한다.

## 단방향 핸드오프 흐름

~~~text
영속화된 Run 문맥
+ 검증된 DiagnosisResult 호환 DTO
+ 영속화된 동일 Run 증거 / 정제된 도구 오류
-> AMDC 결과 해석기가 허용한 상태
-> 모든 상태에서 로컬 ReportAgentInputV1 조립/검증/비밀정보 검사
-> problem_detected가 아니면 Report prompt binding/제공자 호출 없이 원인을 null로 사용
-> problem_detected이면 Report prompt binding 커밋 뒤 도구 없는 리포트 에이전트 최대 한 번 호출
-> problem_detected인 경우 ReportAgentOutputV1 검증 및 비밀정보 검사
-> PRD 03 결정적 7필드 조립/검증/영속화
-> 저장소에서 영속화된 리포트 읽기
-> PRD 03 Discord 투영/전달
~~~

리포트 에이전트는 진단 에이전트에 추가 조사를 요청하지 않는다. 피드백 순환은 향후 범위다.

## 버전이 있는 진단 호환성 DTO

어댑터는 시제품 객체를 직접 전달하지 않고 다음 크기가 제한된 DTO를 만든다. TypeScript
표현은 설명용이며 JSON Schema가 정본이다.

~~~ts
type ArtifactReference = `ev_${string}` | `tool:tc_${string}/${string}`;

interface DiagnosisResultV1 {
  readonly contract_version: "diagnosis-result/1.0.0";
  readonly inferred_domains: readonly {
    readonly domain: string;
    readonly reason: string;
  }[];
  readonly preliminary_findings: readonly {
    readonly finding: string;
    readonly basis: readonly ArtifactReference[];
    readonly level: "normal" | "warning" | "critical" | "unknown";
  }[];
  readonly suspected_causes: readonly {
    readonly cause: string;
    readonly basis: readonly ArtifactReference[];
    readonly confidence: "low" | "medium" | "high";
  }[];
  readonly recommended_checks: readonly string[];
  readonly incomplete_reasons: readonly string[];
}
~~~

규칙:

- 정확한 키만 허용하며 알 수 없거나 누락된 필드는 거부.
- 문자열은 NFC 정규화/앞뒤 공백 제거/한 줄이며 각 항목은 500자 이하.
- 도메인 <= 8, 발견 <= 20, 원인 <= 10, 검사 <= 20, 불완전 사유 <= 20.
- 근거는 1-20개의 고유한 영속화된 동일 Run 증거/오류 참조이며 전부 해석돼야 함.
- 전체 `DiagnosisResultV1`의 RFC 8785 정본 UTF-8 크기는 16 KiB 이하이며 어댑터가
  초과 항목/필드를 임의로 생략하거나 자르지 않고 전체 DTO를 결정적으로 거부.
- 발견/원인은 신뢰하지 않는 힌트이며 상태/정본 관찰 결과를 바꾸지 못함.
- 시제품 `selectedTools`, `ToolObservation`, 증상/`requested_by`와 Discord 메타데이터 제외.
- 원시 제공자/원천 출력, 엔드포인트/질의, 설정/자격 증명 제외.

어느 발견/원인/근거 하나라도 손실 없는 참조 매핑이 불가능하면 항목만
떨어뜨리지 않고 전체 DiagnosisResult/인계를 거부한다. 범용 `normal`
관찰 결과를 정본 음성 증거로 승격하지 않는다.

## ReportAgentInputV1

정본 스키마:

~~~text
schemas/report-agent-input.schema.json
contract_version: report-agent-input/1.0.0
~~~

~~~ts
interface ReportAgentInputV1 {
  readonly contract_version: "report-agent-input/1.0.0";
  readonly report_schema_version: "1.1.0";
  readonly run: {
    readonly run_id: `run_${string}`;
    readonly scenario: "backend_5xx_increase";
    readonly diagnostic_reference_time: string;
  };
  readonly diagnosis: DiagnosisResultV1;
  readonly evidence_schema_version: "1.1.0";
  readonly tool_error_schema_version: "1.0.0";
  readonly evidence: readonly Evidence[];
  readonly tool_errors: readonly SanitizedToolError[];
}
~~~

입력 불변조건:

- 정확한 `report-agent-input/1.0.0`만 허용. 대체 경로/암묵적 마이그레이션 없음.
- Run 값은 영속화된 변경 불가 Run에서만 주입. `diagnostic_reference_time`은 PRD 01의 `runs.started_at`과 정확히 같은 값이며 null이거나 도구 세션의 기준 시각과 다르면 인계를 거부한다.
- `run`은 ID, 시나리오, 진단 기준 시각만 포함한다. 환경은 AMDC Run과
  `ToolRuntimeContext`에만 남고 ReportAgentInput이나 모델 메시지로 전달하지 않는다.
- 증거/오류는 PRD 03 스키마/비밀정보 검사를 통과해 이미 영속화됨.
- 모든 산출물/진단 근거는 정확히 같은 Run이며 배열은 정본 호출 순서.
- 비문제 상태도 이 DTO를 로컬에서 조립·검증한다. 실패 시 인계를 거부하며 제공자 호출이 없는 상태라고 검증을 건너뛰지 않는다.
- 생산자/모델 상태 필드는 수용하지 않음. AMDC는 해석기가 이미
  `problem_detected`를 계산한 경우에만 이 DTO를 제공자에 전달.
- 산출물 0개, 다른 Run 참조, 잘못된 시간 정렬, 해석되지 않은 근거는 제공자 호출 전 거부.
- RFC 8785 정본 UTF-8 입력 <= 96 KiB, 증거 배열은 기존 64 KiB 상한 유지.
- 제공자 외부 전송 직전 전체 입력 비밀정보 검사.
- 원시 `AgentDiagnosisResult`/`ToolObservation` 형식 단언 수용 금지.

## ReportAgentOutputV1

제공자 구조화 출력과 AMDC 포트 결과는 서로 다른 경계다.

~~~ts
interface ReportNarrativeDraftV1 {
  readonly suspected_cause: string | null;
}
~~~

모델은 정확히 한 필드인 `ReportNarrativeDraftV1`만 생성한다. 추가/누락 필드는
제공자 어댑터에서 거부한다. 어댑터가 유효한 초안에 서버 소유 상관관계를
붙여 다음 버전이 있는 포트 결과를 만든다.

정본 스키마:

~~~text
schemas/report-agent-output.schema.json
contract_version: report-agent-output/1.0.0
~~~

~~~ts
interface ReportAgentOutputV1 {
  readonly contract_version: "report-agent-output/1.0.0";
  readonly report_schema_version: "1.1.0";
  readonly run_id: `run_${string}`;
  readonly suspected_cause: string | null;
}
~~~

래퍼 버전/스키마/Run ID는 AMDC가 소유하고 모델이 만든 값은 내부
`suspected_cause` 본문뿐이다. 상태, 요약, 문제, 관찰 결과, 조치,
권한, Discord, 도구 필드를 모델 초안에서 받지 않는다. `null`이 아닌 본문은 NFC
정규화/앞뒤 공백 제거/한 줄, 1-300자이고 비밀정보 검사를 통과해야 한다. 프롬프트는
인과 가설만 요구하며 검증기가 자유형 문장의 인과관계나 함의를
증명한다고 주장하지 않는다. PRD 03이 `가능성: ` 접두사를 붙인다.

Run 조정기는 포트 결과의 정확한 버전/스키마와 입력 `run_id` 상관관계를
다시 검증한다. 운영 어댑터 또는 가짜 구현이 잘못되거나 누락된 래퍼 필드를 반환하면
내부 경계 검증 실패다.

`problem_detected`는 문자열 또는 `null`을 허용한다. 다른 상태는 리포트 에이전트를
호출하지 않고 `null`로 고정한다. 잘못된 모델 초안, 알 수 없거나 누락된 포트 버전, 다른
Run, 크기 초과/비밀정보 출력은 재시도 없이 닫힌 실패 처리한다. 향후 버전 대체 경로는 없다.

## Report Agent 실행 계약

- 별도 `ReportAgentPort`. 진단 메시지 상태/도구 래퍼 공유 0.
- PRD 00 `AMDC_AGENT_MODEL` 사용. 별도 리포트 모델 선택은 P0 비목표.
- `problem_detected` Run당 모델 호출 최대 1회, 다른 상태 0회.
- Report prompt artifact와 버전을 먼저 검증하고 PRD 01
  `report_prompt_version` binding을 커밋한 뒤에만 `ReportAgentPort`를 호출한다.
  포트에는 저장된 버전을 전달하며 현재 구성으로 다시 선택하지 않는다.
- Report prompt binding이 실패하면 Report 제공자 호출과 모델 호출 event는 0회다.
- 도구/진단 피드백/다른 Run 메모리 0.
- 제공자 시간 초과 15초이며 PRD 01 Run 기한이 상한.
- 최대 모델 출력 256토큰과 독립적인 300자 검증기 상한을 모두 적용.
- 자동 제공자/구조화 출력 재시도 0. 잘못된 출력 복구 호출 0.
- 자격 증명, 프로세스 환경, 원시 산출물, Discord 클라이언트 접근 0.
- 정책과 형식화된 데이터를 프롬프트에서 분리하고 모든 진단/산출물 텍스트를 신뢰하지 않는
  데이터로 취급.

### 가짜 리포트 에이전트

테스트 전용 가짜 구현은 같은 `ReportAgentPort`와 정확히 검증된 입력을 사용한다. 제공자
초안 단계의 유효/`null`/잘못된 형식/추가 필드/비밀정보 결과와 포트 단계의 잘못된
버전/Run 상관관계, 시간 초과/제공자 실패를 결정적으로 주입한다. 가짜 구현
주변 검증기, 호출 횟수, 기한, 조립기, 비밀정보 검사, 영속화는 운영
경로와 같아야 한다. 운영 경로는 제공자/설정 실패 때 가짜 구현으로 대체하지 않는다.

## 장애 매핑

| 장애 | Run/리포트 결과 | 제공자/Discord 호출 |
|---|---|---|
| 잘못된 진단/입력 버전/스키마/참조 | `failed/invalid_report_generation`; 리포트 0 | 리포트 0, Discord 0 |
| 예산을 초과한 리포트 호출 | `failed/agent_budget_exhausted`; 리포트 0 | 리포트 최대 1회, Discord 0 |
| 리포트 제공자 시간 초과/사용량 제한/네트워크 | `failed/provider_failure`; 리포트 0 | 리포트 1회, Discord 0 |
| Run 기한이 먼저 도달 | `failed/run_timeout`; 리포트 0 | 지연 상태 변경 0, Discord 0 |
| 잘못된 형식/추가 필드/다른 Run 출력 | `failed/invalid_report_generation`; 리포트 0 | 재시도 0, Discord 0 |
| 리포트 입력/출력의 비밀정보 | `failed/secret_exposure_risk`; 원시 값 폐기 | 재시도 0, Discord 0 |
| 완료 트랜잭션 실패 | 쓰기 가능하면 `failed/storage_failure`, 아니면 즉시 중단 | Discord 0 |
| 커밋 후 Discord 형식/거부/불확실 API 결과 | `completed` 및 영속화된 리포트 변경 없음 | PRD 03 이벤트, 애플리케이션 재시도 0 |

Discord 코드는 `runs.error_code`에 들어가지 않는다. 전달 실패 후 복구 경로는
기존 REST 리포트 엔드포인트다. P0는 전달 토큰/원장과 재전달 API가 없다.

## R0 인수 조건 및 잔여 차단 요소

R0 문서 인수 조건:

- 정확한 ReportAgentInput/Output 버전과 필드 소유권의 단일 정의.
- 리포트 에이전트/AMDC/Discord 책임 중복 0.
- 스키마/의미/비밀정보 검증 뒤 원자적 리포트 영속화.
- 영속화된 리포트 읽기 뒤 Discord 전달.
- 리포트 생성/저장과 Discord 전달 장애 분리.
- PRD 04의 가짜 종단 간 흐름/실패 주입 인수 매트릭스.
- PR #3/#5/#6 유지/조정/상위 구성요소 매핑과 R0 제품 원천/설정/빌드 변경 0.

구현 차단 요소/의존성:

1. 시제품에는 정본 증거/도구 호출 ID와 영속화가 없어 R1 어댑터/저장소
   경로 전에는 리포트를 만들 수 없다.
2. 향후 `report-flow.ts` 추가와 위 `bot.ts` 호출 사슬 교체는 재경의 통합
   검토가 필요하다. 진단 파이프라인/내부 소유권은 그대로 유지한다.
3. 정적 레지스트리와 YAML/전체 도구 노출의 비교는 별도 공동 결정이다.
4. 패키지에 `npm test`가 없어 구현 성공을 주장하지 않는다.
5. 이슈 #4는 최종 리포트 에이전트를 명시적으로 제외한다. 리포트/Discord 구현은
   이슈 #7로 분리했고 `OstenHun`에게 할당했다. 이슈 #7의 GitHub 네이티브 `blocked-by #4`는
   안정적인 도구 호출 근거와 성공/오류 순서를 보존하는 크기가 제한된 진단 출력
   포트에만 적용한다. #4는 `worud8457`이 소유하고 Discord 봇 접점 검토는 #7의
   `Verify` 조건이다. 정본 영속화와 현재 코드 전용 테스트 기반은 #7의
   독립 선행조건이다.

## 명시적 비목표

- 진단 도구/YAML 런타임 또는 실제 원천 어댑터 재설계
- 재경 Discord/진단 구현 삭제·대규모 리팩터링
- 원시 도구/제공자 출력/자격 증명의 리포트 입력·Discord 전달
- 모델이 생성하는 상태/관찰 결과/조치/권한/Discord 메시지
- 리포트 에이전트의 도구 접근 및 진단 피드백 순환
- Discord 임베드/다중 메시지, 전달 원장/토큰, 애플리케이션 재시도/재전달
- Trigger, 변경 작업, 셸/SSH/제공자 CLI/임의 SQL/HTTP, 복구 조치
- R0 제품 원천/설정/빌드/스키마/잠금 파일 변경. 이슈 #7과 문서 전용 PR은
  구현 또는 전달 완료 증거가 아닌 인계/추적기 산출물이다.

## 상위/과도기 진단 런타임 기록

아래 제품 범위부터 미결 질문까지의 이전 하위 절은 PR #5/#6 설계와
현재 구현 근거를 보존한다. 리포트 인계나 현재 도구 정책을 정의하지 않으며
PRD 00/02와 충돌할 때 규범 계약으로 사용하지 않는다. 삭제 여부와
정적/YAML 승격은 별도 상위 결정이다. 아래 기록의 소유·필수·권고,
포함/제외와 성공 기준 표현은 모두 과거 제안의 인용이며
현재 구현 권한이나 인수 조건을 만들지 않는다. 이 기록은 과거 제안의 한국어 번역·재현이며 비규범적이다(원문 기준: develop@71f2069, PR #5/#6).

### 제품 범위 (과도기 기록)

Diagnostic Agent의 제품 목표는 운영자가 입력한 장애 증상 또는 향후 Trigger가 만든
이상 상황을 바탕으로, AMDB 운영 환경의 여러 관측 데이터를 조사하고 Report Agent가
사용할 수 있는 1차 진단 결과를 만드는 것이다.

MVP 입력 예:

~~~text
/diagnose symptom:"AMDB 접속이 안 됩니다"
~~~

진단 에이전트는 최종 운영자용 문장을 완성하지 않는다. 에이전트의 결과는 리포트
에이전트 또는 리포트 모듈이 읽을 수 있는 구조화된 판단 자료다.

### 핵심 원칙 (과도기 기록)

Tool은 장애 사례별로 만들지 않는다.

피해야 할 예:

~~~text
502_error_tool
db_connection_error_tool
login_fail_tool
backup_failed_tool
~~~

사용할 예:

~~~text
db plugin
proxy plugin
backend plugin
logs plugin
metrics plugin
network plugin
backup plugin
~~~

에이전트는 "502 전용 도구"를 찾지 않는다. 먼저 "이 증상은 backend/proxy/network/db 중
어떤 범주와 관련이 있는가"를 판단하고, 해당 도메인 플러그인의 도구 목록을 확인한다.
도구는 과거 사례 검색 도구가 아니라 현재 운영 환경을 조회하고 검증하는 실제
진단 도구다.

### 실행 흐름 (과도기 기록)

~~~text
Discord / REST API / Trigger
-> runDiagnosis()
-> 진단 에이전트
-> 플러그인 레지스트리
-> 선택된 플러그인의 도구 설명자
-> 도구 실행 요청
-> AMDC 도구 런타임
-> YAML 도구 정의
-> 환경/질의/명령 주입
-> 읽기 전용 원천 실행
-> 정제 / 정규화
-> ToolObservation
-> 진단 에이전트
-> DiagnosisResult
-> 리포트 에이전트
~~~

### 컴포넌트 책임 (과도기 기록)

#### 진단 에이전트

진단 에이전트의 책임:

- 입력된 `symptom` 이해
- 현재 문제 범주 추론
- 필요한 플러그인 선택
- 선택된 플러그인 안에서 필요한 도구 선택
- 도구 런타임으로 실행 요청 생성
- ToolObservation 해석
- 1차 원인 후보와 근거 정리
- 추가 확인 필요 항목 정리
- 리포트 에이전트에 넘길 DiagnosisResult 생성

진단 에이전트가 해서는 안 되는 일:

- 프로세스 환경 직접 읽기
- 자격 증명, 토큰, 개인 키 접근
- 엔드포인트 URL 직접 조립
- PromQL/LogQL/원시 SQL/셸 명령 직접 생성
- 개발/운영 환경 임의 변경
- 원천 어댑터 직접 호출
- 변경 도구 호출

#### 플러그인 레지스트리

플러그인 레지스트리는 운영 도메인별 도구 묶음을 관리한다.

에이전트가 처음 보는 정보는 플러그인 수준의 설명이다.

~~~ts
interface AgentVisiblePluginDescriptor {
  readonly name: string;
  readonly description: string;
  readonly domainHints: readonly string[];
}
~~~

예시:

~~~text
db
- MySQL 상태, 연결, 느린 질의, 복제 관련 진단 도구 묶음

proxy
- ProxySQL 백엔드 상태, 라우팅, 연결 풀 관련 진단 도구 묶음

backend
- AMDB Backend 상태 확인, API 오류, 의존성 상태 관련 진단 도구 묶음

logs
- Loki 기반 에러 로그, 패턴, 시간대별 로그 조회 도구 묶음

metrics
- Prometheus 기반 서비스 지표, 자원 지표, 오류율 조회 도구 묶음
~~~

에이전트가 플러그인을 선택하면 그 플러그인의 정제된 도구 설명자만 제공한다.

~~~ts
interface AgentVisibleToolDescriptor {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly readOnly: true;
}
~~~

에이전트 표시 설명자에는 원천 URL, 환경 키, 자격 증명 이름, 질의 템플릿,
명령 템플릿, 시간 초과 정책, 어댑터 구현이 포함되지 않는다.

#### 도구 런타임

도구 런타임의 책임:

- YAML 도구 목록 적재
- 도구 이름 중복 검증
- 도구 입력 스키마 검증
- 서버 소유 환경 선택
- 허용 환경 검증
- 환경 키 해석
- 명령/질의/HTTP 요청 템플릿 조립
- 시간 초과, 예산, 취소 적용
- 읽기 전용 실행 강제
- 원시 출력 정제
- 정규화된 ToolObservation 생성
- 정제된 ToolError 생성

도구 런타임은 에이전트 요청을 그대로 실행하지 않는다. 에이전트 요청은 도구 이름과
스키마에 맞는 인수일 뿐이며, 실제 실행 방식은 YAML과 서버 소유 설정에서만
결정된다.

### YAML Tool 정의 계약 (과도기 기록)

YAML은 도구 실행 계약을 소유한다. 비밀정보 값은 YAML에 쓰지 않고 배포
환경에서 주입한다.

예시:

~~~yaml
name: backend_error_logs
plugin: logs
description: 최근 AMDB Backend 에러 로그 패턴을 조회한다.
readOnly: true
source: loki
allowedEnvironments:
  - dev
  - prod
timeoutMs: 10000
env:
  required:
    - LOKI_URL
input:
  type: object
  properties:
    windowMinutes:
      type: number
      enum: [5, 10, 30]
    maxPatterns:
      type: number
      minimum: 1
      maximum: 10
  required:
    - windowMinutes
    - maxPatterns
execution:
  type: http
  method: GET
  url: "${LOKI_URL}/loki/api/v1/query_range"
  query:
    query: "{app=\"amdb-backend\"} |= \"error\""
    limit: "${maxPatterns}"
redaction:
  removeHeaders:
    - authorization
  maskPatterns:
    - token
    - password
    - secret
normalization:
  outputKind: log_patterns
~~~

YAML에는 실행 방식과 필요한 환경 키 이름이 들어갈 수 있지만, 실제 자격 증명 값은
절대 들어가지 않는다.

### Tool 실행 계약 (과도기 기록)

에이전트 요청:

~~~ts
interface ToolExecutionRequest {
  readonly toolName: string;
  readonly args: unknown;
}
~~~

런타임 문맥:

~~~ts
interface ToolRuntimeContext {
  readonly runId: string;
  readonly toolCallId: string;
  readonly environment: "dev" | "prod";
  readonly referenceTime: Date;
  readonly deadline: Date;
  readonly signal: AbortSignal;
}
~~~

런타임 결과:

~~~ts
type ToolRuntimeResult =
  | { ok: true; observation: ToolObservation }
  | { ok: false; error: SanitizedToolError };
~~~

ToolObservation:

~~~ts
interface ToolObservation {
  readonly toolName: string;
  readonly pluginName: string;
  readonly source: "prometheus" | "loki" | "amdb_backend" | "mysql" | "proxysql" | "mock";
  readonly status: "normal" | "warning" | "critical" | "unknown";
  readonly summary: string;
  readonly facts: readonly {
    readonly label: string;
    readonly value: string | number | boolean | null;
    readonly unit?: string;
  }[];
  readonly collectedAt: string;
}
~~~

원시 원천 응답은 리포트 에이전트에 전달하지 않으며 증거로 저장하지 않는다.
정제되고 정규화된 관찰 결과만 도구 런타임 경계를 통과한다.

### 진단 에이전트 출력

진단 에이전트는 DiagnosisResult를 반환한다.

~~~ts
interface DiagnosisResult {
  readonly symptom: string;
  readonly inferredDomains: readonly {
    readonly domain: string;
    readonly reason: string;
  }[];
  readonly observations: readonly ToolObservation[];
  readonly preliminaryFindings: readonly {
    readonly finding: string;
    readonly basis: readonly string[];
    readonly level: "normal" | "warning" | "critical" | "unknown";
  }[];
  readonly suspectedCauses: readonly {
    readonly cause: string;
    readonly reason: string;
    readonly confidence: "low" | "medium" | "high";
  }[];
  readonly recommendedChecks: readonly string[];
  readonly incompleteReasons: readonly string[];
}
~~~

환경은 진단 에이전트의 입력·출력 필드가 아니다. 어댑터는 선택된 환경을
DiagnosisResult 또는 `DiagnosisResultV1`에 추가하지 않으며, 도구 런타임이 AMDC
내부 `ToolRuntimeContext`로만 사용한다.

진단 문구 예시:

~~~text
Backend 로그에서 최근 10분간 데이터베이스 연결 시간 초과 패턴이 반복적으로 확인됨.
Prometheus 기준 Backend 5xx 비율이 직전 기준 구간보다 높음.
ProxySQL 백엔드 서버 상태는 정상으로 확인됨.
현재로서는 Backend와 MySQL 연결 구간 문제가 우선 의심됨.
~~~

### 리포트 에이전트 경계 (과도기 기록)

진단 에이전트가 소유하는 것:

- 조사할 범주 선택
- 도구 선택
- 도구 실행 요청
- 관측 결과 해석
- 1차 판단 생성

이 이전 제안은 리포트 에이전트에 운영자 문장, 해결 방법, 채널 형식과 승인
표현까지 넓게 부여했다. 2026-08-28 현재 개정본이 이를 대체한다. 규범적
리포트 에이전트는 `ReportNarrativeDraftV1.suspected_cause` 본문만 만든다. AMDC 어댑터가
이를 버전이 있는 `ReportAgentOutputV1`으로 감싸고 PRD 03 흐름이 나머지 필드,
검증, 영속화와 Discord 투영을 소유한다.

향후 확장:

리포트 에이전트가 추가 진단을 요청할 수 있다.

~~~text
리포트 에이전트:
"현재 근거로는 부족하다. db 플러그인의 연결 관련 도구를 추가로 확인해 달라."

진단 에이전트:
추가 도구 실행 -> 갱신된 DiagnosisResult 반환
~~~

이 피드백 순환은 MVP에 포함되지 않는다. MVP는 진단 에이전트에서 리포트 에이전트로
이어지는 단방향 흐름을 유지한다.

### MVP 범위 (과도기 기록)

포함:

- Discord `/diagnose` 또는 REST 진입점에서 `symptom` 수신
- `runDiagnosis()` 호출
- 진단 에이전트 기본 인터페이스
- 플러그인 레지스트리 기본 인터페이스
- YAML 도구 목록 적재기
- YAML 기반 도구 런타임
- 에이전트 표시 플러그인 설명자
- 에이전트 표시 도구 설명자
- ToolObservation 정규화
- DiagnosisResult 생성

제외:

- MCP 서버/클라이언트/전송/탐색
- 에이전트의 직접 셸/SSH/제공자 CLI 실행
- 에이전트의 임의 PromQL/LogQL/SQL 생성
- 운영 환경 변경 작업
- Trigger 자동화
- 리포트 에이전트의 추가 진단 재요청 순환
- RAG/vector DB 기반 과거 사례 검색
- 실제 Prometheus/Loki/AMDB 원천 매핑 확정

### 최초 구현 슬라이스 (과도기 기록)

최초 구현 슬라이스는 정적 YAML 도구 설명자와 LangChain 도구 래퍼를 사용한다.
실제 원천 어댑터는 이후 도구 코어를 통해 연결하며 에이전트에 직접 노출하지 않는다.

플러그인 예시:

~~~text
logs
- backend_error_logs

metrics
- backend_5xx_rate

backend
- backend_health
~~~

예상 동작:

1. 운영자가 증상을 보낸다.
2. 에이전트가 관련 도메인을 결정한다(예: `backend`, `logs`, `metrics`).
3. 런타임은 선택된 플러그인의 도구 설명자만 노출한다.
4. 에이전트가 선택한 도구 실행을 요청한다.
5. 실제 어댑터가 연결되면 YAML 도구 런타임은 정제된 ToolObservation을 반환하고,
   그렇지 않으면 정제된 `source_unavailable`을 반환한다.
6. 에이전트가 DiagnosisResult를 생성한다.
7. Discord 어댑터가 임시 리포트 형태 출력을 반환한다.

### 성공 기준 (과도기 기록)

- 에이전트는 원천 URL, 자격 증명, 환경 값 또는 명령 템플릿을 받지 않는다.
- 에이전트는 정제된 설명자에서 플러그인/도구를 선택할 수 있다.
- 도구 런타임은 YAML 도구 정의를 검증하고 관찰 결과를 꾸며내지 않은 채 사용할 수 없는
  원천을 거부한다.
- 도구 런타임은 알 수 없는 도구 이름과 잘못된 인수를 거부한다.
- 도구 런타임은 정제된 ToolObservation 또는 SanitizedToolError를 반환한다.
- DiagnosisResult에는 추론된 도메인, 관찰 결과, 예비 발견, 의심 원인,
  권장 검사가 포함된다.
- 기존 Discord 어댑터는 도구 런타임 내부를 알지 못해도 `runDiagnosis()`를 호출할 수 있다.
- 형식 검사와 빌드가 통과한다.

### 미결 질문 (과도기 기록)

- YAML 스키마 형식: JSON Schema, Zod가 생성한 JSON Schema 또는 사용자 정의 최소 스키마.
- 플러그인 지연 적재를 한 단계에서 LLM이 주도할지, 에이전트가 도구 설명자를 보기 전에
  결정적 도메인 분류기가 제어할지 여부.
- 정규화된 ToolObservation을 어디에 영속화할지.
- 첫 도구 선택 전에 과거 장애 문맥을 얼마나 주입할지.
- 실제 AMDB 원천 중 무엇을 먼저 통합할지: Loki, Prometheus 또는 AMDB Backend API.
