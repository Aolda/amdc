# PRD 02. 에이전트, 도구 코어 및 첫 시나리오

상태: 현재
최종 검토: 2026-08-28
소유 범위: 진단 에이전트 권한, 도구 인터페이스/코어 실행, 첫 시나리오 판정, 인계 생산자 규칙

## 게이트 검토

[핵심 검토]
게이트 상태: ready_for_design

LangChain이 도구를 선택하는 것과 원천을 실행하는 것은 다른 권한이다. 에이전트가
환경, 엔드포인트, 질의, 시간 초과를 결정하면 도구 스키마를 지켜도 운영 환경 오조회와
정책 우회가 가능하다. P0는 환경을 변경 불가 Run 문맥으로 주입하고 모든
LangChain 도구 래퍼를 도구 코어의 단일 실행 경로로 만든다.
핵심 인터페이스와 가짜 수직 흐름은 구현 가능한 수준이지만, 실제 Prometheus,
Loki, Backend의 질의/경로/응답 매핑은 현재 저장소와 Notion에 정본
값이 없다. 실시간 어댑터는 PRD 05의 원천 계약이 확정되기 전 구현하지 않는다.

진단 에이전트가 최종 리포트나 Discord 문장을 만들면 상위 조사와
운영자 대상 결과 소유권이 다시 결합된다. 2026-08-28 개정은 진단
에이전트를 버전 관리되는 정제 생산자로 제한하고 별도 리포트 에이전트 예산과 인계
스키마를 PRD 06에 둔다. `develop@71f2069` 내부는 R0에서 수정하지 않는다.

[대안 비교]

도구 래퍼가 원천 어댑터를 직접 호출하면 코드가 짧지만 검증, 예산,
정제가 분산된다. 도구 코어 한 곳으로 실행을 모으면 래퍼가 단순해지고
실패 주입이 가능하다. P0는 순차 실행으로 예산 경합과 원천
폭주를 제거하며, 병렬 도구 호출은 후속 성능 요구가 생길 때 검토한다.

[실행 가능한 다음 단계]

PRD 04의 핵심 인계로 읽기 전용 도구 계약 테스트 대역과 아래 결과 매트릭스를
만든다. 동시에 AMDB 담당자와 PRD 05의 실제 원천 매핑을 닫아야 전체 P0가
`ready_for_implementation`으로 승격된다.

## 첫 진단 시나리오

시나리오 ID:

~~~text
backend_5xx_increase
~~~

입력 예:

~~~text
최근 10분 동안 AMDB Backend 5xx가 증가했다.
~~~

조사 목표:

1. Prometheus 지표로 현재 구간과 직전 동일 길이 기준 구간을 비교한다.
2. Loki에서 같은 시간대의 정제된 오류 패턴을 확인한다.
3. AMDB Backend 상태와 의존성 요약을 확인한다.
4. 수집 결과를 정본 증거로 정규화한다.
5. AMDC 결과 해석기가 허용 리포트 상태를 계산한다.
6. 진단 에이전트가 정제된 1차 발견/원인/검사 힌트를 `DiagnosisResult`로 만든다.
7. AMDC 인계 어댑터가 영속화된 증거/오류와 DiagnosisResult를 PRD 06의
   버전이 있는 `ReportAgentInput`으로 결합한다.
8. 리포트 에이전트는 허용된 경우 원인 초안만 만들고 AMDC가 PRD 03의 7필드 리포트를
   결정적으로 조립한다.

첫 시나리오 이외의 장애 범위와 자연어 시나리오 분류는 P0 완료 조건이 아니다.

## 실행 인터페이스

~~~ts
interface ToolExecutionContext {
  readonly runId: string;
  readonly toolCallId: string;
  readonly environment: "dev" | "prod";
  readonly diagnosticReferenceTime: Date;
  readonly deadline: Date;
  readonly signal: AbortSignal;
}

interface PublicToolDescriptor<TInput> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: StandardSchema<TInput>;
}

interface InternalDiagnosticAdapter<TInput, TOutput> {
  readonly descriptor: PublicToolDescriptor<TInput>;
  readonly source: "prometheus" | "loki" | "amdb_backend";
  readonly outputSchema: StandardSchema<TOutput>;
  readonly allowedEnvironments: readonly ("dev" | "prod")[];
  readonly readOnly: true;
  readonly timeoutMs: number;
  readonly sourceContractVersion: string;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
}

type ToolCoreResult =
  | { ok: true; evidence: Evidence }
  | { ok: false; error: SanitizedToolError };

interface ToolCoreSession {
  execute(toolName: string, agentArgs: unknown): Promise<ToolCoreResult>;
  close(): void;
}
~~~

`StandardSchema<T>`는 실행 시 검증과 TypeScript 추론을 함께 제공하는 스키마
구현을 뜻하며 P0 구현은 Zod를 사용한다.

환경은 도구 입력이 아니다. `POST /v1/runs`에서 검증한 값이 변경 불가
`ToolExecutionContext.environment`로 주입된다. 에이전트가 개발 환경 Run에서 운영 환경을
선택하거나 덮어쓸 필드가 존재하지 않아야 한다.

`diagnosticReferenceTime`은 `queued`가 아니라 `queued -> running` 전이 시 서버가 한
번 고정한다. 지표의 현재 구간과 로그 구간은 이 시각에 끝나고, 지표 기준 구간은
그 바로 앞의 동일 길이다. 같은 Run의 재호출도 호출 시각이 아니라 이 참조를
사용해 비교 가능한 구간을 유지한다.

도구는 시작 시 코드로만 등록하고 설명자/레지스트리를 깊게 동결한다. 이름 중복, 잘못된 스키마,
`readOnly !== true`, 활성 환경과 도구 허용 목록 불일치는 시작 오류다.
에이전트에는 이름, 설명, 정제된 입력 스키마만 노출한다. 원천, 엔드포인트,
헤더, 자격 증명, 질의 템플릿, 출력 구현과 내부 어댑터 참조는
노출하지 않는다.

## P0 도구

### backend_5xx_rate

- 원천: Prometheus 읽기 API
- 에이전트 입력: `window_minutes`, 허용값 `5 | 10 | 30`
- 문맥 입력: 불변 `environment`
- 시간 초과: 10초
- 원천 계약 버전: `backend_5xx_rate/v1`

출력:

~~~json
{
  "current_range": {"start": "...", "end": "..."},
  "baseline_range": {"start": "...", "end": "..."},
  "request_count": 1000,
  "error_5xx_count": 42,
  "error_rate": 0.042,
  "baseline_request_count": 1200,
  "baseline_error_5xx_count": 5,
  "baseline_error_rate": 0.004,
  "source_assessment": "elevated",
  "reason": "rate_and_delta_threshold_exceeded"
}
~~~

판정은 에이전트가 아니라 어댑터가 계산한다.

- 현재 또는 기준 요청 수가 100 미만이면 `insufficient_data`
- 현재 5xx 수 >= 5, 현재 비율 >= 0.01이고 다음 중 하나면 `elevated`
  - 현재 비율 >= 기준 비율의 2배
  - 현재 비율 - 기준 비율 >= 0.01
- 그 외는 `not_elevated`
- 누락된 시계열, NaN/Infinity, 역전된 타임스탬프, 카운터/비율 해석 불가는
  `insufficient_data`

`source_assessment=elevated|not_elevated`이면 모든 수/비율 값은 `null`이 아니다.
`insufficient_data`에서도 동일 필드를 유지하되 알 수 없는 값은 `null`로 보존한다.
사유 매핑은 elevated=`rate_and_delta_threshold_exceeded`,
not_elevated=`below_elevation_threshold`, insufficient_data=
`low_sample|missing_series|malformed_series`다. 수 값은 음이 아닌 안전한 정수,
5xx 수는 요청 수 이하여야 하고 비율은 유한한 0-1 값이어야 한다. 어댑터가
계산한 비율과 수의 비가 허용 오차 1e-9 안에서 일치해야 한다.

PromQL과 기준 구간 계산은 PRD 05에서 확정한 버전이 있는 서버 소유 원천
계약에 고정한다.

### backend_error_log_patterns

- 원천: Loki 읽기 API
- 에이전트 입력: `window_minutes` (`5 | 10 | 30`), `max_patterns` (1-10)
- 문맥 입력: 불변 `environment`
- 시간 초과: 10초
- 원천 계약 버전: `backend_error_log_patterns/v1`

출력:

~~~json
{
  "time_range": {"start": "...", "end": "..."},
  "patterns": [
    {"pattern": "dependency request failed: <redacted>", "count": 12,
     "first_seen": "...", "last_seen": "..."}
  ],
  "truncated": false,
  "source_assessment": "errors_observed"
}
~~~

`source_assessment`는 `errors_observed | none_observed | insufficient_data`다. 질의 성공과
완전한 구간이 확인된 상태에서 정제된 패턴이 1개 이상이면
`errors_observed`, 0개면 `none_observed`다. 부분 페이지나 서버 소유 검사 한도
전에 중단된 결과는 `insufficient_data`다. 잘못된 타임스탬프/응답은 증거가
아니라 `malformed_source_response` 도구 오류다. 원시 로그 본문은 도구 코어를 넘지
않으며 저장·제공자 전송하지 않는다. LogQL과 패턴 정규화는
PRD 05의 버전이 있는 서버 소유 원천 계약에 고정한다.

`errors_observed`는 패턴 1-10개, `none_observed`는 정확히 0개다. 패턴은
정규화 텍스트로 고유하고 개수 내림차순, 패턴 오름차순으로 정렬한다.
각 `first_seen <= last_seen`이고 둘 다 요청된 시간 구간 안이어야 한다.

### backend_health

- 원천: AMDB Backend 읽기 전용 상태 확인 API
- 에이전트 입력: 빈 객체
- 문맥 입력: 불변 `environment`
- 시간 초과: 5초
- 원천 계약 버전: `backend_health/v1`

출력:

~~~json
{
  "service_status": "healthy",
  "dependencies": [
    {"name": "database", "status": "healthy"}
  ],
  "checked_at": "...",
  "source_assessment": "healthy"
}
~~~

서비스/의존성 상태 값은 `healthy | degraded | unhealthy | unknown`이며
의존성은 최대 20개다. `source_assessment`는 서비스와 의존성의 최악값
집계이며 `unhealthy > degraded > healthy` 순서다. 알 수 없는 상태나 20개 초과로
잘린 의존성은 `insufficient_data`다. 누락된 필수 필드는 증거가
아니라 `malformed_source_response` 도구 오류다. 의존성 이름은 고유하다. 오래된
`checked_at`은 `source_assessment=insufficient_data`로 정규화한다. `checked_at`이 Tool
코어 수신 시각보다 30초 이상 과거이거나 미래이면 오래된 값이다. URL과 인증은
PRD 05의 서버 소유 어댑터가 고정한다.

## 실시간 원천 통합 게이트

위 세 도구의 입력/출력/판정 의미는 이 문서가 소유한다. 실제 지표 이름,
레이블 선택자, PromQL/LogQL, 페이지네이션, Backend 상태 확인 경로와 전송 내용 매핑은
[PRD 05](05-live-source-integration.md)가 소유한다. 이 값은 에이전트 입력이나 범용
임의 질의 설정이 아니며, 코드 검토된 버전이 있는 원천 계약이어야 한다.
PRD 05가 `ready_for_implementation`이 되기 전에는 가짜 어댑터로 핵심을 검증할 수
있지만 실제 어댑터와 개발 환경 간이 점검 완료를 주장할 수 없다.

## 도구 코어 적용 규칙

Run 조정기가 영속화된 Run 레코드에서 비공개 변경 불가 문맥을 만들고
도구 코어에 전달해 Run별 세션을 생성한다. 문맥 객체와 환경은
도구 코어 비공개 상태에 보관하며 래퍼나 에이전트에 반환하지 않는다. 모든
LangChain 도구 래퍼는 자신에게 클로저로 주입된 세션의 다음 함수만
호출한다.

~~~ts
session.execute(toolName, agentArgs)
~~~

에이전트/래퍼가 `runContext`, 환경, 기한, 자격 증명 해석기를
매개변수로 전달하거나 새 세션을 만들 수 없다. 세션 ID가 필요하면
추측 불가능한 불투명 값으로 도구 코어 내부에서만 관리한다. 최종 상태 전환 시
`close()`한다. 이후 호출은 원천 실행, 도구 오류/관찰 결과 저장, Run 상태 변경
없이 내부 `session_closed` 결과로 버린다. 이는 PRD 03의 정제된 도구 오류
목록이 아니라 지연 콜백 불변조건 위반이며 고정
`internal_policy_violation` 로그/지표만 남긴다.

도구 코어 순서:

1. 호출 시도를 원자적 Run별 예산에 반영
2. 등록된 도구 확인
3. 에이전트 입력 스키마 검증
4. 변경 불가 Run 환경과 런타임/도구 허용 목록 확인
5. `readOnly === true` 확인
6. 동일 도구와 전체 호출 예산 확인
7. 서버 소유 엔드포인트와 자격 증명 해석
8. 도구별 시간 초과와 Run 기한을 결합한 `AbortSignal` 적용
9. 원시 응답을 UTF-8 기준 최대 64 KiB에서 중단
10. 출력 스키마 검증
11. 비밀정보 검사와 정제
12. 증거 정규화와 PRD 03 소유 바이트 예산 확인
13. 정제된 `ToolCoreResult`만 에이전트와 영속화 계층에 반환

잘못되거나 차단된 시도도 전체 호출 예산을 소비한다. 시간 초과는 `Promise.race`로
끝내지 않고 실제 HTTP/원천 작업에 AbortSignal을 전달한다. 기한 이후
결과는 폐기하며 뒤늦은 콜백이 상태나 DB를 변경하지 못한다.

알 수 없는 도구나 직접 어댑터 호출은 실행되지 않는다. 컴파일 시점 가져오기
경계를 둔다. `src/agent/**`와 LangChain 래퍼는 동결된 공개 설명자와
불투명 `ToolCoreSession` 형식만 가져올 수 있고 내부 레지스트리, 어댑터,
런타임 설정, 자격 증명 해석기 가져오기는 정적 검사와 의존성 테스트에서 실패한다.
통합 테스트도 도구 코어 우회를 확인한다. LangChain 제공 호출 제한 미들웨어는
심층 방어일 뿐 도구 코어의 정본 예산을 대체하지 않는다.

## 진단 결과 및 인계 생산자 경계

진단 에이전트 출력은 최종 리포트가 아니다. 생산자 측 `DiagnosisResult`는
추론된 도메인, 예비 발견, 증거에 근거한 의심 원인 힌트,
권장 검사와 불완전 사유만 표현한다. 최종 `status`, 고정 요약,
탐지된 문제, 정본 관찰 결과, 권장 조치, 권한 플래그 또는
Discord 표현을 포함하면 안 된다.

Run 조정기는 수락된 증거와 도구 오류를 먼저 스키마/비밀정보 검사 후
저장한다. 그 뒤 PRD 06의 인계 어댑터가 다음을 검증한다.

- DiagnosisResult 전체를 신뢰하지 않는 데이터로 취급하고 정확한 스키마/크기/문자열 정책 적용
- 발견/원인의 근거가 같은 Run의 영속화된 증거/도구 오류 참조인지 확인
- 시제품 `ToolObservation`이나 `selectedTools`를 정본 증거로 형식 강제 변환하지 않음
- `run_id`, 시나리오, 변경 불가 환경, 진단 참조 시각을 서버 소유
  Run 레코드에서만 주입
- 원시 `problem`/`requested_by`, 원시 제공자/원천 출력, 엔드포인트/질의/자격 증명,
  Discord 사용자/길드/상호작용 데이터를 인계에서 제외

잘못된 생산자 출력, 해석되지 않은 근거, 다른 Run 참조, 알 수 없는 인계 버전은
리포트 제공자를 호출하기 전에 닫힌 실패 처리한다. 정확한 입력/출력 스키마와 버전
정책은 PRD 06, 최종 실패/산출물 의미는 PRD 03이 단독 소유한다.

## 에이전트 실행 계약

- 운영 진단 실행기: LangChain.js v1 `createAgent`
- 진단 도구: 정적 P0 래퍼 3개만
- Run별 진단 모델 호출: 최대 5회
- 진단 구조화 출력: 버전 관리되는 정제된 `DiagnosisResult`
- 리포트 에이전트 모델 호출: `problem_detected`일 때 최대 1회, 그 외 0회
- 리포트 에이전트 도구/피드백 호출: 0회
- Run별 통합 모델 호출: 최대 6회. 두 예산은 서로 전용하지 않음
- Run별 도구 호출: 최대 8회
- Run별 동일 도구 호출: 최대 3회
- 하나의 Run 내 도구 실행: 순차 실행. 병렬 실행 0회
- 진단/리포트 호출별 제공자 시간 초과: 각각 15초
- 전체 실행 벽시계: PRD 01의 60초
- 자동 도구/제공자/구조화 출력 재시도: 0. Discord 애플리케이션 수준 재시도: 0

도구 호출 예산은 도구 코어에 들어오는 세 `DiagnosticTool` 호출만 센다.
`responseFormat` 구현이 내부적으로 사용하는 구조화 출력 가상 도구는 원천을
실행하지 않고 도구 예산에 포함하지 않지만 해당 제공자 호출은 해당 에이전트의 모델
호출 예산과 Run 기한에 포함된다.

진단 호출 다섯 번 뒤 유효한 DiagnosisResult가 없거나 여섯 번째 진단
호출을 요구하면 `failed/agent_budget_exhausted`다. 이 예산을 리포트 에이전트에
넘기지 않는다. `problem_detected`일 때 리포트 호출 한 번은 별도로 예약한다.
리포트 에이전트의 정확한 입력/출력, 최대 출력 토큰, 시간 초과, 가짜 구현과 버전 정책은
PRD 06이 소유한다.

AMDC가 소유하는 `status`, 고정 `summary`, 결정적 `detected_problem`, 정본
`observations`, 고정 `recommended_next_action`, `needs_additional_permission`은 어느
모델 출력으로도 받지 않는다. 리포트 에이전트가 도구 호출, 추가 필드 또는 두 번째
모델 호출을 요구하면 `failed/invalid_report_generation` 또는
`failed/agent_budget_exhausted`로 닫힌 실패 처리한다. 제공자 시간 초과/사용량 제한/네트워크는
`failed/provider_failure`, Run deadline이 먼저 도달하면 `failed/run_timeout`이다.
모델 예산 실패는 도구 호출이 아니므로 정제된 도구 오류를 만들지 않는다.

여러 도구 호출이 한 모델 메시지에 포함돼도 도구 코어가 호출 순서대로 하나씩
실행한다. 남은 호출/시간/증거 예산을 넘는 호출은 실행하지 않고
정제된 오류로 반환한다. Run 벽시계가 모든 개별 시간 초과보다 우선한다.

에이전트 상태, 메시지 이력, 도구 결과는 Run마다 새로 만들고 최종 상태 전환 후
참조를 해제한다. P0는 다른 Run 메모리, 체크포인트, 재개를 사용하지 않는다.

## 결과 판정기

도구별 성공 출력을 정본 증거 판정으로 매핑한다.

- 양성: 지표 `elevated`, 로그 `errors_observed`, 상태 확인 `degraded|unhealthy`
- 음성: 지표 `not_elevated`, 로그 `none_observed`, 상태 확인 `healthy`
- 결론 불가: 성공 출력의 `insufficient_data` 또는 알 수 없음

실패/차단 도구는 증거를 만들지 않으며 해석기에서는 검사 범위 공백으로
취급한다.

P0 리포트 상태 우선순위:

| 조건 | 허용되는 리포트 상태 |
|---|---|
| 양성 증거가 1개 이상 | `problem_detected` |
| 양성 없음 + 필수 도구에 `source_permission_denied` | `needs_permission` |
| 세 필수 도구 모두 검사 범위가 유효한 음성이고 오류/결론 불가 없음 | `no_problem_detected` |
| 그 외: 시간 초과, 실패, 데이터 없음, 예산/기한 부족 | `insufficient_tools` |

부분 실패가 있어도 양성 증거가 이미 문제를 직접 증명하면
`problem_detected`를 유지하고 실패한 범위를 `observations`에 명시한다.
같은 도구를 재호출한 경우 수락된 증거/오류 전부를 접는다. 하나라도
양성이면 첫 행이 이기고, 양성이 없을 때 권한 거부가 둘째 행을
이긴다. `no_problem_detected`는 세 도구 각각에 음성이 1개 이상 있고 그 Run에
도구 오류나 결론 불가 증거가 하나도 없을 때만 가능하다. 지표와 로그의
음성 구간은 같은 `diagnosticReferenceTime`과 같은 `window_minutes`여야 하며,
상태 확인 `checked_at`은 그 참조의 ±30초 안이어야 한다. 이 검사 범위가 맞지 않으면
`insufficient_tools`다.
예산 소진은 같은 표로 판정하며 그 자체를 정상 근거로 쓰지 않는다.

유효한 완료 리포트에는 정본 관찰 결과가 최소 1개 필요하다. 에이전트가
증거나 도구 오류가 하나도 생기기 전에 최종화를 시도하면 AMDC는 사용자
문제를 근거로 리포트를 만들지 않고 `failed/invalid_report_generation`으로
종료한다.

AMDC가 리포트 인계 전에 허용 상태와 정본 관찰 결과를 계산한다.
`problem_detected`이면 별도 리포트 에이전트가 PRD 06 입력 안에서 의심 원인 본문만
반환하고, 그 외 상태는 제공자 호출 없이 원인을 `null`로 고정한다. AMDC 리포트
조립기가 상태, 요약, 탐지된 문제, 관찰 결과, 후속 조치, 권한
플래그를 주입하고 PRD 03 검증/영속화 순서를 따른다. 문제가 아닌 상태에서
원인이 생기거나 초안 형태가 잘못되면 `failed/invalid_report_generation`으로 종료한다.

## 신뢰할 수 없는 데이터 규칙

로그, 지표 레이블, 상태 확인 메시지, 도구 문자열은 전부 데이터다. 그 안의 명령,
프롬프트, URL, 역할 표식을 시스템 지침으로 해석하지 않는다. 에이전트 프롬프트는
정책, 사용자 문제, 증거/오류를 별도 구획과 형식화된 직렬화로 전달한다.
도구 데이터가 레지스트리 밖 호출, 환경 변경, 비밀정보/설정 요청을 지시해도
무시한다.

## 제공자 경계

- `DiagnosticAgentPort`와 `ReportAgentPort` 각각 뒤에 운영 LangChain/OpenAI
  어댑터와 테스트 전용 가짜 구현을 둔다. 두 포트의 메시지 상태와 예산은 공유하지 않는다.
- 운영 제공자는 진단 도구 호출과 두 에이전트의 설정된
  구조화 출력 전략을 지원해야 시작을 통과한다.
- 제공자/모델 ID, 프롬프트 버전, 도구 집합 버전을 Run 메타데이터에 저장한다.
- 실제 자격 증명이 없거나 제공자가 실패할 때 가짜 모델로 대체하지 않는다.
- 제공자 시간 초과/사용량 제한/네트워크 실패는 자동 재시도 없이 정제된 실패로
  전달한다.
- 단위/통합/동시성 테스트는 모델/원천 가짜 구현만 사용한다. 가짜 리포트도 PRD
  06의 정확한 입력/출력 검증기를 우회하지 않는다.

## 검증 소유권

에이전트, 도구 코어, 첫 시나리오와 결과 해석기의 실행 가능한 성공 기준은
[PRD 04](04-verification-and-handoff.md)가 소유한다.
