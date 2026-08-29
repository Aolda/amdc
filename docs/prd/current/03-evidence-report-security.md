# PRD 03. 증거, 리포트 및 보안

상태: 현재
최종 검토: 2026-08-28
소유 범위: 증거/도구 오류, 리포트 조립/검증/영속화, Discord 전달 실패, 보안/관측성

## 게이트 검토

[핵심 검토]
게이트 상태: ready_for_implementation

스키마 검증 JSON만으로 진단의 의미가 안전해지지는 않는다. 리포트 상태는 실제
증거/오류와 일치해야 하고, 모든 관찰 결과는 저장된 근거나 정제된 도구
오류로 추적돼야 한다. P0는 JSON Schema와 AMDC 의미 검증기를 모두
통과한 산출물만 저장한다.

리포트 에이전트 출력도 신뢰 경계 밖의 신뢰할 수 없는 초안이다. 모델이 정본 리포트나
Discord 메시지를 직접 만들게 두면 상태/관찰 결과를 조작하거나 영속화 전
내용을 노출할 수 있다. P0는 리포트 에이전트를 `suspected_cause` 본문 하나로 제한하고,
AMDC 검증과 원자적 영속화가 끝난 뒤에만 Discord 투영을 허용한다.

[대안 비교]

원시 원천 출력을 저장하면 재분석은 쉽지만 비밀정보와 운영 데이터 노출면이
커진다. 요약 문자열만 저장하면 검증과 단위가 사라진다. P0는 도구별 형식화된 전송 내용과
원천/시간/버전 메타데이터를 가진 크기가 제한된 증거를 저장하고 원시 전송 내용은
즉시 폐기한다.

리포트 에이전트가 Discord 문장을 직접 전송하는 방식은 경로가 짧지만 리포트 생성과
전달 실패를 합친다. P0는 영속화된 정본 리포트를 단일 기준으로 두고
Discord를 결정적 전달 어댑터로 분리한다.

[실행 가능한 다음 단계]

증거/리포트/인계 검증기와 의미 결정 고정 데이터를 구현해 제공자를
붙이기 전에 잘못된, 크기 초과, 추적 불가, 비밀정보 포함 산출물을 모두 거부한다.
가짜 Discord에서도 영속화된 리포트를 읽기 전 전달 호출이 0임을 증명한다.

## 증거 계약

정본 검증기:

~~~text
schemas/evidence.schema.json
schema_version: 1.1.0
~~~

예시:

~~~json
{
  "evidence_id": "ev_01J4Z3Y7YJ7T5B5W9R7F6A2K1M",
  "run_id": "run_01J4Z3XZE5N7N7P0B6H0D3K2Q1",
  "tool_call_id": "tc_01J4Z3Y6R8R1W4M7Q8A2C6V9N0",
  "tool_name": "backend_5xx_rate",
  "source": "prometheus",
  "source_contract_version": "backend_5xx_rate/v1",
  "time_range": {
    "start": "2026-07-22T00:00:00.000Z",
    "end": "2026-07-22T00:10:00.000Z"
  },
  "category": "metric",
  "assessment": "positive",
  "severity": "warning",
  "summary": "최근 10분 Backend 5xx 비율이 baseline보다 증가했다.",
  "payload": {
    "baseline_range": {
      "start": "2026-07-21T23:50:00.000Z",
      "end": "2026-07-22T00:00:00.000Z"
    },
    "request_count": 1000,
    "error_5xx_count": 42,
    "error_rate": 0.042,
    "baseline_request_count": 1200,
    "baseline_error_5xx_count": 5,
    "baseline_error_rate": 0.004,
    "source_assessment": "elevated",
    "reason": "rate_and_delta_threshold_exceeded"
  },
  "truncated": false,
  "redaction_status": "passed",
  "collected_at": "2026-07-22T00:10:01.000Z"
}
~~~

규칙:

- 정확히 지정된 필드만 허용하며, 추가/누락 필드는 검증 실패
- 범주: `metric | log | health`
- 판정: `positive | negative | inconclusive`
- 심각도: `info | warning | critical | unknown`
- 범용 키/값 사실이 아니라 `tool_name`으로 구분되는 형식화된 `payload`를 사용한다.
  지표는 기준/현재 수와 비율, 로그는 최대 10개 정제된 패턴,
  상태 확인은 서비스와 최대 20개 의존성 상태를 보존한다.
- 원천 시간과 어댑터 계약 버전을 반드시 포함
- 상태 확인 증거는 `time_range.start=end=checked_at`
- 스키마의 도구/원천/범주/원천 계약 조합은 세 P0 도구의 고정 매핑만
  허용한다.
- 타임스탬프는 밀리초 고정 정규식뿐 아니라 RFC 3339 달력 검증기를
  통과해야 한다. `time_range.start <= time_range.end <= collected_at`을 의미
  검증기가 확인한다.
- 원시 로그 표본, 원시 응답, 엔드포인트, 질의, 자격 증명 필드는 존재하지 않음
- 증거 항목은 RFC 8785 JSON 정본화 방식으로 직렬화한 UTF-8 바이트
  길이 최대 16 KiB
- 한 Run에 저장하고 에이전트에 전달하는 수락된 증거 배열 전체의 정본
  UTF-8 바이트 길이는 최대 64 KiB
- 정규화기는 모델 요약으로 크기를 줄이지 않음
- 어댑터가 서버 소유 한도로 패턴/의존성을 줄인 경우만
  `truncated=true`
- 새 항목으로 64 KiB를 넘으면 그 항목을 저장하지 않고
  `evidence_budget_exhausted` 도구 오류를 기록한 뒤 기존 증거로 최종화
- 스키마, 비밀정보 검사, 정제를 통과하지 못한 항목은 DB와 제공자에 전달하지
  않음

도구 출력과 증거 매핑:

| 도구 원천 판정 | 증거 판정 | 심각도 |
|---|---|---|
| metric `elevated` | positive | warning |
| metric `not_elevated` | negative | info |
| metric `insufficient_data` | inconclusive | unknown |
| log `errors_observed` | positive | warning |
| log `none_observed` | negative | info |
| log `insufficient_data` | inconclusive | unknown |
| health `healthy` | negative | info |
| health `degraded` | positive | warning |
| health `unhealthy` | positive | critical |
| health `insufficient_data` | inconclusive | unknown |

지표 기준 구간은 현재 구간 바로 앞의 동일 길이여야 한다. 로그 패턴은
`pattern`, `count`, `first_seen`, `last_seen`을 하나의 형식화된 항목으로 유지한다.
상태 확인 의존성 이름은 항목 안에서 고유하고 서비스/의존성의 최악값이
원천 판정과 일치해야 한다. 지표의 수/비율/사유/임계값, 로그의
판정/개수/고유 패턴/시간 포함 관계, 상태 확인의 집계/잘림,
모든 유한하고 안전한 수와 시간 관계는 JSON Schema에 더해 애플리케이션 의미
검증기가 확인한다. 스키마/JCS 전에 `Number.isFinite`와 안전한 정수 보호 규칙을
적용한다.

## 정제된 Tool Error 계약

Source 실패는 Evidence가 아니다. `tool_calls`에 안전한 code만 저장하고 API/Agent
경계에서는 다음 정확한 형식으로 재구성한다.

정본 검증기:

~~~text
schemas/tool-error.schema.json
schema_version: 1.0.0
~~~

~~~json
{
  "tool_call_id": "tc_01J4Z3Y6R8R1W4M7Q8A2C6V9N0",
  "tool_name": "backend_health",
  "source": "amdb_backend",
  "code": "tool_timeout",
  "retryable": false,
  "occurred_at": "2026-07-22T00:10:01.000Z"
}
~~~

P0 코드:

| 코드 | 의미 | 고정 관찰 결과 메시지 |
|---|---|---|
| `unknown_tool` | 레지스트리에 없음. `source=tool_core`, 실행 0 | 등록되지 않은 도구 요청을 차단했다. |
| `invalid_input` | 에이전트 입력 스키마 실패. 원천 호출 0 | 도구 입력이 허용 스키마를 통과하지 못했다. |
| `environment_not_allowed` | Run/서버/도구 허용 목록 불일치. 원천 호출 0 | Run 환경에서 이 도구 실행을 허용하지 않았다. |
| `budget_exhausted` | 전체/동일 도구 진단 호출 예산 소진 | 진단 도구 호출 예산이 소진됐다. |
| `tool_timeout` | 도구 기한에 실제 작업 중단 | 도구 호출이 제한 시간 안에 끝나지 않았다. |
| `tool_output_too_large` | 원시 출력 64 KiB 초과로 중단/폐기 | 도구 응답이 허용 크기를 초과해 폐기됐다. |
| `malformed_source_response` | 출력 스키마 또는 타임스탬프 실패 | 원천 응답 형식이 계약과 일치하지 않았다. |
| `source_unavailable` | 네트워크/5xx 등으로 읽기 원천 사용 불가 | 읽기 전용 원천을 사용할 수 없었다. |
| `source_permission_denied` | 필수 읽기 원천이 401/403 반환 | 읽기 전용 원천 조회 권한이 부족했다. |
| `evidence_budget_exhausted` | 수락된 증거 배열의 64 KiB 초과 방지 | 증거 저장 예산을 초과해 새 항목을 제외했다. |
| `redaction_failed` | 안전한 정제를 보장할 수 없어 산출물 폐기 | 안전한 정제를 보장할 수 없어 응답을 폐기했다. |
| `secret_exposure_risk` | 비밀정보 표식 탐지. Run은 닫힌 실패 처리 | 리포트를 만들지 않으므로 관찰 결과 없음 |

`retryable`은 P0에서 항상 `false`다. 상위 상태 본문, 예외 메시지, 스택,
URL, 질의, 자격 증명 식별자는 오류에 넣지 않는다. 같은 도구의 여러 실패는
서로 다른 `tool_call_id`와 `call_index`로 보존한다.

도구 오류의 `source`는 `tool_core | prometheus | loki | amdb_backend`다. 알려진 도구는
레지스트리의 고정 원천을 사용한다. `unknown_tool`은 에이전트가 제안한 원시 이름을
반사하지 않고 고정 `tool_name=unknown`, `source=tool_core`와 PRD 01의 대체
원천 계약 메타데이터를 사용한다.
`occurred_at`은 증거와 같은 밀리초 고정 RFC 3339 검증기를 통과한다.
모델 예산/제공자/Run 기한은 도구 호출이 아니므로 도구 오류를 만들지 않고
PRD 01의 Run error code로만 종료한다.

## Report 계약

PRD 06의 제공자 대상 `ReportNarrativeDraftV1`은 `suspected_cause` 본문 하나만
가지며, AMDC 어댑터가 버전/Run 상관관계를 붙여 `ReportAgentOutputV1` 포트
결과를 만든다. 둘 다 정본 리포트가 아니다. 모델이 생성하는 최종 리포트
필드는 이 본문을 AMDC가 NFC 정규화하고 앞뒤 공백을 제거한 뒤 `가능성: ` 접두사를 붙인
`suspected_cause` 하나뿐이다.
`problem_detected`가 아니면 리포트 에이전트를 호출하지 않고 이 필드를 `null`로 고정한다.
`status`, `summary`, `detected_problem`, `observations`, `recommended_next_action`,
`needs_additional_permission`을 모델 출력에서 받으면 추가 필드로 거부한다.

정본 검증기:

~~~text
schemas/monitoring-report.schema.json
schema_version: 1.1.0
~~~

리포트는 정확히 다음 7개 필드만 가진다.

~~~json
{
  "status": "problem_detected",
  "summary": "저장된 Evidence에서 문제 신호가 확인되었다.",
  "detected_problem": "최근 10분 Backend 5xx 비율이 baseline보다 증가했다.",
  "observations": [
    "[ev_01J4Z3Y7YJ7T5B5W9R7F6A2K1M] 5xx 비율이 baseline보다 증가했다."
  ],
  "suspected_cause": "가능성: Backend dependency health 저하",
  "recommended_next_action": "positive Evidence와 관련 dependency 상태를 수동 확인하고 담당자에게 에스컬레이션한다.",
  "needs_additional_permission": false
}
~~~

필드 제한:

- summary: 1-500 문자
- detected_problem: null 또는 1-500 문자
- observations: 1-20개 항목, 각 1-500 문자, 중복 없음
- suspected_cause: null 또는 1-1000 문자
- recommended_next_action: 1-1000 문자

Observation 추적 형식과 내용은 AMDC가 결정적으로 만든다.

- 증거: `[<evidence_id>] <Evidence.summary의 정확한 텍스트>`
- 도구 실패: `[tool:<tool_call_id>/<error_code>] <고정 목록 메시지>`

Evidence 요약은 최대 400 문자, 고정 도구 오류 메시지도 최대 400
문자로 제한해 접두사를 포함한 Observation이 500 문자를 넘지 않게 한다.
`secret_exposure_risk`는 Report를 만들지 않으므로 도구 오류 Observation 열거형에는
포함하지 않는다.

리포트 조립기는 수락된 증거와 도구 오류를 호출 순서로 정렬해 정본
관찰 결과 배열을 만든다. 모델이 관찰 결과 주장을 작성하거나 수정하지
않는다. 의미 검증기는 배열이 같은 Run의 정본 배열과 정확히 일치하는지
확인한다. 자유형 문장의 함의를 검증기가 판정한다고 주장하지 않는다.
리포트에 엔드포인트, 질의, 원시 메시지를 복사하지 않는다.

AMDC가 상태별 요약, 탐지된 문제, 후속 조치도 결정적으로 조립한다.

| 상태 | 고정 요약 | `detected_problem` | 고정 `recommended_next_action` |
|---|---|---|---|
| `problem_detected` | 저장된 증거에서 문제 신호가 확인되었다. | 호출 순서상 첫 양성 `Evidence.summary`의 정확한 텍스트 | 양성 증거와 관련 의존성 상태를 수동 확인하고 담당자에게 에스컬레이션한다. |
| `no_problem_detected` | 세 필수 검사에서 문제 신호가 확인되지 않았다. | `null` | 기존 모니터링을 계속하고 새 증상이 생기면 별도 Run을 생성한다. |
| `insufficient_tools` | 수집 범위가 부족해 문제 여부를 판단할 수 없다. | `null` | 누락되거나 결론을 내릴 수 없는 읽기 전용 원천을 수동 확인한다. |
| `needs_permission` | 필수 읽기 전용 원천의 조회 권한이 부족하다. | `null` | 필수 원천의 읽기 전용 조회 권한을 요청한다. |

증거 요약, 정제된 패턴/의존성 이름, 서술 초안과 최종 리포트
문자열은 NFC 정규화 후 앞뒤 공백을 제거한다. 공백만 있는 값, C0 제어 문자, DEL, CR/LF를
거부한다. 최종 리포트 전체도 RFC 8785 정본 UTF-8 기준 64 KiB 이하여야 한다.
`null`이 아닌 `suspected_cause`는 `가능성: ` 접두사로 가설임을 표시한다. 의미
검증기는 이 모델 서술 필드의 실제 인과관계를 증명한다고 주장하지
않으며, 스키마/비밀정보 정책만 강제한다. 후속 조치는 모델 출력이 아니므로 URL,
셸/CLI 명령, 배포·재시작·삭제·설정 변경 지시가 들어갈 경로가 없다.

상태 불변 조건:

| status | detected_problem | suspected_cause | permission flag |
|---|---|---|---|
| `problem_detected` | non-empty string | string 또는 null | false |
| `no_problem_detected` | null | null | false |
| `insufficient_tools` | null | null | false |
| `needs_permission` | null | null | true |

PRD 02의 결과 해석기가 허용 상태를 계산한다. JSON Schema는 위
조건부 필드 규칙을 강제하고, 의미 검증기는 상태와 실제
증거/오류의 일치를 강제한다.

리포트 에이전트 구조화 출력은 정본 리포트 자체가 아니라 PRD 06 래퍼 안의
`suspected_cause` 본문 하나만 생성한다. AMDC 리포트 조립기가 상태, 고정 요약,
결정적 탐지 문제, 관찰 결과, 고정 후속 조치, 권한 플래그를 넣어
최종 7필드 객체를 만든다.

상태 우선순위와 도구/모델/제공자/기한 결과는 PRD 02의 결과 해석기가
단독 소유한다. 정본 관찰 결과가 0개면 리포트를 만들지 않는다.
- 잘못된 초안, 추가/누락/잘못된/추적 불가 최종 필드는 리포트 저장을 거부하고
  `failed/invalid_report_generation`
- 잘못된 구조화 출력에 제공자/모델 재시도를 하지 않음

## 정본 Report 파이프라인 및 영속화 순서

한 Run의 순서는 다음으로 고정한다.

1. 도구 코어가 수락된 증거/도구 오류를 스키마/비밀정보 검사 후 저장한다.
2. AMDC가 결과 해석기와 정본 관찰 결과를 계산한다.
3. PRD 06의 동일 Run `ReportAgentInputV1`을 정확한 스키마/버전/비밀정보로 검사한다.
4. `problem_detected`이면 도구 없는 리포트 에이전트를 최대 한 번 호출하고 출력을
   스키마/크기/비밀정보로 검사한다. 다른 상태는 제공자 호출 없이 원인을 `null`로 둔다.
5. AMDC가 정본 7필드 리포트를 조립해 JSON Schema, 의미, 동일 Run 추적,
   최종 비밀정보 검사를 수행한다.
6. PRD 01의 완료 트랜잭션으로 리포트 삽입과 `running -> completed` CAS를
   원자적으로 커밋한다.
7. 활성 Discord 상호작용에서 접수된 Run이면 얇은 어댑터가 트랜잭션 뒤
   저장소에서 영속화된 리포트의 정확한 객체를 다시 읽어 포매터에 전달한다.
8. 포매터의 크기가 제한된 투영을 다시 비밀정보 검사한 뒤 Discord API를 한 번 호출한다.

1-6 중 실패하면 리포트 0개, `completed` 전이 0개, Discord 리포트 호출 0개다. 완료
커밋 전 메모리 내 초안이나 검증 성공만으로 Discord를 호출할 수 없다. 6 뒤
Discord 포매터/API가 실패해도 `completed` Run/리포트를 `failed`/`absent`로 되돌리거나
리포트를 삭제·수정하지 않는다.

## Discord 투영 및 전달 계약

Discord는 정본 리포트 스키마나 리포트 에이전트 출력 형식을 소유하지 않는다.
포매터 입력은 `run_id`와 저장소에서 다시 읽은 스키마에 맞는 7필드 리포트
뿐이다. 증거/오류 배열, DiagnosisResult, 원시 모델/원천 출력, 엔드포인트/질의,
Discord 자격 증명/상호작용 토큰을 받지 않는다.

Discord 전달 훅은 접수 처리기가 프로세스 메모리에서만 보유하는 최선 노력
상호작용 참조다. DB/리포트/Run에 목적지, 상호작용 토큰 또는 전달
상태를 저장하지 않는다. 프로세스 로컬 `claimOnce` 시도 담당자 하나가 같은 실제
상호작용의 포매터/API 호출을 소유하며 중복/지연 콜백 패자는 호출 0이다.
이 최대 한 번 불변조건은 같은 프로세스 수명의 한 상호작용에만 적용된다.

훅이 같은 프로세스에서 API 호출 전 만료·소실되면 `discord_delivery_failed`,
`attempt_count=0` 이벤트를 남긴다. 리포트 커밋 뒤 프로세스 중단 시에는 재시작이
목적지를 복원하거나 최종 전달 이벤트를 재구성하지 않으며 자동
재전송하지 않는다. API 수락과 로컬 이벤트 사이 프로세스 중단 시에는 이벤트가 없을 수
있다. 어느 경우에도 전달 완료를 주장하지 않고 완료 리포트의 REST 조회만
보장한다.

P0 Discord 출력은 결정적 일반 텍스트 한 건이다.

- 전체 전송 내용 상한은 접미사/마크업을 포함해 유니코드 1,900자다.
- 상태, 요약과 `run_id`는 필수다. 나머지는 정본 필드 순서로 추가한다.
- 관찰 결과는 항목 경계에서만 포함하고 누락 개수와 `run_id` 조회 안내를 남긴다.
- 서술 미리보기가 잘리면 유니코드 코드 포인트 경계와 명시적 줄임표를 사용한다.
- 포매터는 리포트에 없는 주장, 해결 명령, URL 또는 채널별 상태를
  추가하지 않는다.
- 필수 투영도 안전하게 만들 수 없거나 최종 비밀정보 검사가 실패하면 API
  호출 없이 `discord_format_failed`다.

애플리케이션 수준 자동 전달 재시도는 0이다. 결정적 Discord 거부는
`discord_delivery_failed`, 시간 초과/네트워크 단절/응답 확인 모호성은 전달 여부를
추정하지 않고 `discord_delivery_unconfirmed` 이벤트로 기록한다. 같은 상호작용에
자동 재전송하지 않는다. 이 전달 코드는 `runs.error_code`가 아니며 리포트
생성 실패를 뜻하지 않는다.

`claimOnce`가 리포트 전달에 소비된 뒤의 거부/시간 초과/네트워크 예외는
전달 단계 내부에서 이벤트로 종결한다. 이를 범용 처리기로 다시 던져 고정
안전 오류 `editReply`를 호출하면 두 번째 애플리케이션 수준 전달 시도가 되므로
금지한다. 소유권 확보 전 접수/생성 실패만 같은 시도 담당자를 통해 고정
안전 오류 응답 한 건을 확보할 수 있다.

전달 이벤트는 관측 전용 구조화 로그/지표이고 영속화된 전달 테이블이
아니다. 아래 전달별 필드는 공통 구조화 로그 봉투의 `timestamp`,
`level`, `stage=discord_delivery`에 추가된다: `request_id`, `run_id`, `adapter=discord`,
`outcome=delivered|failed|unconfirmed`,
`error_code=null|discord_format_failed|discord_delivery_failed|discord_delivery_unconfirmed`,
`attempt_count=0|1`, `duration_ms`. 이 외 전달별 필드와 전송 내용,
Discord 응답/오류,
길드/사용자/상호작용/토큰은 저장·로그하지 않는다. 리포트는 기존
`GET /v1/runs/:runId/report`로 계속 조회할 수 있다. P0는 전달 토큰/원장,
재전달 API와 수동/자동 재전송을 제공하지 않으며 재전달은 후속 계약이다.

## 보안 파이프라인

순서는 다음과 같다.

1. Authorization 헤더를 본문/문맥/로그에서 분리
2. `problem`/`requested_by` 입력 사전 검사. 탐지 시 Run 생성 전 422
3. 서버 소유 엔드포인트/질의/자격 증명/Discord 필드를 에이전트 표시 데이터에서 제거
4. 진단 제공자 입력을 외부 전송 직전 검사
5. 크기가 제한된 원시 도구 출력을 메모리에서 검사하고 허용된 운영 식별자만 정제
6. 형식화된 증거 정규화 후 스키마/크기/최종 비밀정보 검사
7. ReportAgentInput의 정확한 스키마/동일 Run/비밀정보 검사 후 리포트 제공자에게 전송
8. 리포트 제공자 출력 스키마/크기/비밀정보 검사 후 7필드 조립과
   리포트 스키마/의미/최종 비밀정보 검사
9. 통과한 정제된 인수, 증거, 오류 코드, 리포트만 트랜잭션으로 저장
10. 영속화된 리포트 전용 Discord 투영을 최종 비밀정보 검사한 뒤 한 번 전달

비밀정보 검사는 최소한 다음을 탐지한다.

- 프로세스에 적재된 비어 있지 않은 비밀정보 값의 정확한 일치. 길이 8 이상
- Authorization/쿠키 자격 증명 정보
- API 키/토큰/비밀번호로 식별되는 키-값
- 개인 키/PEM, 서비스 계정 개인 키·비밀 자료
- 자격 증명이 포함된 URL 사용자 정보와 민감한 질의 매개변수
- 알려진 제공자 토큰 접두사와 JWT 형태 자격 증명

정제는 비밀이 아닌 운영 식별자를 크기가 제한된 대체 문자열로 바꾸고 산출물을
계속 사용할 수 있는 경우다. 정확히 일치하는 적재 비밀정보, 개인 키, 원시 인증 정보처럼
안전한 복구를 보장할 수 없는 탐지는 정제로 덮지 않고 닫힌 실패 처리한다.
높은 엔트로피만으로 비밀정보를 단정하지 않으며 거짓 양성 고정 데이터를 유지한다.

비밀정보 표식 발견 시:

- 현재 원시 산출물을 즉시 폐기
- 증거/리포트/자유형 오류로 저장하지 않음
- 리포트 완료 전 Run이 이미 있으면 `failed/secret_exposure_risk`
- 로그에는 `request_id`, `run_id`, 단계, 고정 오류 코드만 기록
- 비밀정보 값, 일부 문자열, 되돌릴 수 있는 해시/지문을 기록하지 않음

영속화된 리포트에서 만든 Discord 투영의 최종 검사가 실패하면 투영을
폐기하고 `discord_format_failed`만 기록한다. 이미 완료된 Run과 저장된 리포트를
변경하지 않는다. 이는 영속화된 리포트 자체가 앞 단계 검사를 통과했다는 불변조건을
깨지 않고 전달을 닫힌 실패 처리하기 위한 어댑터 수준 처리다.

## 실패 및 산출물 매트릭스

| 실패/조건 | Run | 리포트 | 영속화된 안전한 산출물 |
|---|---|---|---|
| 잘못된/민감한 POST | 없음 | 없음 | request_id 로그만 기록 |
| 큐 가득 참 | 없음 | 없음 | 큐 메트릭만 기록 |
| 도구 시간 초과/데이터 없음, 양성 증거 없음 | `completed` | `insufficient_tools` | 도구 오류 + 수락된 증거 |
| 부분 도구 실패 + 양성 증거 | `completed` | `problem_detected` | 도구 오류 + 양성 증거 |
| 필수 원천 권한 거부, 양성 없음 | `completed` | `needs_permission` | 도구 오류 + 수락된 증거 |
| 모든 필수 검사 음성 | `completed` | `no_problem_detected` | 음성 증거 3개 |
| 잘못된/알 수 없는/다른 Run 리포트 인계 | `failed/invalid_report_generation` | 없음 | 증거 + 도구 오류만 저장. 리포트 제공자/Discord 호출 0회 |
| 제공자 시간 초과/사용량 제한/네트워크 | `failed/provider_failure` | 없음 | 호출 전 커밋된 안전한 증거 + 도구 오류 |
| 모델 호출 예산 소진 | `failed/agent_budget_exhausted` | 없음 | 호출 전 커밋된 안전한 증거 + 도구 오류 |
| 잘못된 형식/의미 오류 모델 출력 | `failed/invalid_report_generation` | 없음 | 증거 + 도구 오류만 저장 |
| Run 벽시계 시간 초과 | `failed/run_timeout` | 없음 | 기한 전 수락된 산출물 |
| DB 쓰기/리포트 완료 실패 | 쓰기 가능하면 `failed/storage_failure`, 아니면 즉시 중단 | 없음 | 롤백 전 커밋된 안전한 산출물만 저장 |
| Run 생성 후 비밀정보 노출 위험 | `failed/secret_exposure_risk` | 없음 | 현재 원시 산출물 폐기. 이전 안전 산출물 보존 |
| 리포트 커밋 후 Discord 투영 오류 | `completed` 유지 | 영속화된 리포트 유지 | `discord_format_failed`, Discord API 호출 0회 |
| 리포트 커밋 후 Discord 결정적 거부 | `completed` 유지 | 영속화된 리포트 유지·조회 가능 | `discord_delivery_failed`, 어댑터 호출 1회, 애플리케이션 재시도 0회 |
| 커밋 후 Discord 시간 초과/네트워크/응답 확인 모호성 | `completed` 유지 | 영속화된 리포트 유지·조회 가능 | `discord_delivery_unconfirmed`, 어댑터 호출 1회, 애플리케이션 재시도 0회 |

DB 장애로 최종 상태도 저장할 수 없으면 API와 로그는 `storage_unavailable`만
알리고 `completed`를 주장하지 않는다. 프로세스는 PRD 01의 장애 정지/복구 경로를
따른다. `failed` Run의 보존된 안전 산출물은 Evidence API에서 조회할 수 있다.

## 관측성

구조화된 로그 필드:

- `timestamp`, `level`
- `request_id`, `run_id`: 할당된 경우
- `stage`: `api | admission | queue | diagnostic_agent | tool_core | evidence | report_agent | report | storage | discord_delivery | cleanup | shutdown`
- `tool_call_id`, `tool_name`: 해당하는 경우
- `duration_ms`, `error_code`
- `prompt_version`, `toolset_version`, `model_id`는 Run 시작/종료 event에만

최소 메트릭:

- 안전한 상태/오류 코드별 Run 접수/완료/실패 계수기
- 대기열 대기/실행 게이지와 대기열 포화 계수기
- Run, 제공자, 도구 지연 시간 히스토그램
- 도구/코드별 도구 오류 계수기
- 증거/리포트 검증 실패 계수기
- 정제 횟수와 비밀정보 위험 닫힌 실패 횟수. 원시 일치 값 레이블 금지
- 리포트 에이전트 호출/시간 초과/잘못된 출력 계수기와 지연 시간 히스토그램
- Discord 전달 시도/결과/오류 계수기와 지연 시간 히스토그램. 안전한 enum 레이블만 허용

기본 로그에서 문제 전문, `requested_by`, 프롬프트, 원시 도구/제공자 출력, 리포트
본문, Discord 전송 내용/응답/사용자/길드/상호작용, 엔드포인트, 질의, 토큰을 기록하지
않는다. `request_id`와 `run_id`로 API/Discord 접수부터 리포트와 전달 이벤트까지
연결할 수 있어야 한다.

## 검증 소유권

증거, 리포트, 보안, 실패 의미의 실행 가능한 성공 기준과 고정 데이터는
[PRD 04](04-verification-and-handoff.md)가 소유한다.
