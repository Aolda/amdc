# PRD 04. 검증 및 구현 인계

상태: 현재
최종 검토: 2026-09-04
핵심 계약 게이트 상태: ready_for_implementation
리포트 전달 계약 게이트 상태: ready_for_implementation
전달 상태: not_started
소유: 핵심 성공 지표, 테스트 환경, 파일 경계, 구현 순서, 롤백, 완료 판정

## 게이트 검토

[핵심 검토]
Gate Status: ready_for_implementation

기존 `scripts/validate_skeleton.py` 성공은 MCP/YAML 플러그인과 이전 `.claude`
자산을 검증할 뿐 Fastify, LangChain, 도구 코어, SQLite 구현을 검증하지 않는다.
현재 P0는 `npm test`가 현재 코드 전용 테스트를 실제로 실행할 때부터 구현 진척으로
계산한다. PR #3·#5·#6의 병합, `npm run build` 성공과 Discord 가짜 응답은
ReportAgent 인계, 정본 영속화 또는 전달 실패 검증이 아니다.

2026-09-04 `origin/develop@71f2069` 원천을 다시 대조한 결과, 현재 자동화된
`test`/smoke/E2E 명령과 테스트 파일은 없고 `npm run typecheck`만 현재 의존성
상태에서 통과했다. 이 결과는 TypeScript 정적 검사 근거일 뿐 REST, Run/SQLite,
도구 코어, Evidence/Report, 실패 주입이나 Discord 전달 순서를 검증하지 않는다.

이 게이트와 아래 인계는 API/대기열/저장, 진단 에이전트/도구 코어, 가짜 원천,
증거/오류, 리포트 에이전트/조립/영속화와 가짜 Discord 전달을 대상으로
한다. 실제 원천 어댑터와 개발 환경 간이 점검의 정확한 매핑은 PRD 05가 소유하며 아직
`ready_for_design`이다.

[트레이드오프 분석]

모든 테스트를 실제 AMDB/OpenAI에 의존시키면 실제성은 높지만 재현과 실패
주입이 불가능하다. 가짜 구현만 쓰면 제공자/원천 통합을 놓친다. P0는
결정적 가짜 테스트 모음을 핵심 완료 게이트로 두고, PRD 05의 원천 계약이
확정된 뒤 별도 개발 환경 읽기 전용 간이 점검을 데모 게이트로 둔다. 운영 환경 간이 점검은 자동화하지
않는다.

[실행 가능한 다음 단계]

Node/TypeScript 테스트 골격, 정본 증거/도구 오류/리포트와 PRD 06 인계
스키마 테스트, 가짜 에이전트/Discord 수직 흐름을 먼저 만들고 이전 고정 데이터/검증기를
현재 테스트 명령의 성공 근거에서 제외한다.

## 재현 가능한 테스트 환경

성능 임계값은 다음 기준 환경에서 측정한다.

- Node.js 20.x, 의존성 잠금 파일 그대로 설치
- 운영 빌드, 테스트 전용 가짜 진단/리포트 모델, 도구와 Discord 전송 계층
- 최소 4 vCPU, 8 GiB RAM, 로컬 SSD 작업공간
- SQLite WAL + PRD 01의 사용 중 시간 초과
- 같은 프로세스에서 20회 준비 Run 후 측정
- 지연 시간 부하마다 최소 5회 반복, 각 반복 p95 중 최악값 사용
- 단조 시계로 서버 측 시간과 클라이언트 관찰 시간을 함께 기록
- GC 강제 호출에 의존하지 않음
- 실제 네트워크 결과와 가짜 성능 측정 결과를 같은 표본에 섞지 않음

다른 환경에서 실행하면 CPU/RAM/OS/Node 버전, 부하, 표본 수를 결과와 함께
기록하고 임계값 비교 여부를 명시한다.

## 성공 지표

### 정확성 및 추적성

- 고정 데이터 결과 4개: `problem_detected`, `no_problem_detected`,
  `insufficient_tools`, `needs_permission`
- 모든 저장 증거/리포트가 정본 JSON Schema 통과
- 모든 리포트가 실제 동일 Run 증거/오류와 의미 검증기 통과
- 지원 인계 버전 정확히 1개, 알 수 없음/추가 필드/다른 Run 인계 허용 0건
- 리포트 에이전트가 생성한 정본 필드는 `suspected_cause` 본문 외 0개
- 추적 불가 관찰 결과 저장 0건
- 필수 도구 실패를 숨긴 `no_problem_detected` 0건
- 리포트 추가/누락/조건 위반 필드 허용 0건
- 수락 Run은 정확히 한 최종 상태에 도달. 최종 전이 중복 0건
- 개발 Run의 운영 원천 호출과 다른 Run 상태 누출 0건
- 리포트 완료 커밋 전 Discord 리포트 호출 0건
- Discord 전달 실패가 완료 Run/리포트를 변경한 표본 0건

### 보안

- API/Discord 입력, 두 에이전트 제공자 입력/출력, 정제된 인수, 증거, 도구 오류,
  로그, 리포트, SQLite, Discord 전송 내용에서 주입된 비밀정보 노출 0건
- 레지스트리/도구 코어 밖 실행 0건
- 변경 작업/셸/SSH/제공자 CLI/임의 SQL/HTTP 경로 0개
- 원천 기한 이후 상태/DB 변경 0건
- 인증 실패 응답/로그 차이로 토큰 정보를 추론할 분기 0건

### 지연 시간 및 읽기 성능

- 접수 부하: 가짜 Run 실행 <= 50 ms 조건에서 200 POST를 10 rps로 제출,
  성공 POST p95 <= 200 ms, 예상 밖 429/5xx 0건
- 읽기 부하: 10,000개 최종 상태 고정 데이터 Run에서 무작위 Run/증거/리포트/목록
  읽기 각 1,000회, 엔드포인트별 p95 <= 300 ms
- 가짜 진단 -> 리포트 에이전트 -> 영속화 -> 가짜 Discord 종단 간 흐름 100개 Run의 실행
  시간 p95 <= 10초
- 개발 환경 실제 간이 점검 Run 실행 시간 <= PRD 01 벽시계 기한

접수 지연 시간과 Run 완료 지연 시간을 별도 히스토그램으로 측정한다. 429는
접수 성공 지연 시간 표본에 넣지 않고 포화 결과에 별도 계산한다.

### 동시성 및 백프레셔

- 작업자를 래치로 막은 상태에서 PRD 01의 설정된 접수 허가 수까지만
  수락되고 다음 요청은 429. 수락 + 거부 = 제출
- 202 수락 요청은 모두 DB 행이 있고, DB가 고정 데이터 복구 지점에서 다시
  쓰기 가능해진 뒤 최종 상태에 도달한다. 거부 요청은 DB 행 0개 또는 명시적
  접수 실패 행만 가진다.
- 실행 중 작업자 수가 PRD 01의 설정된 동시성을 초과한 표본 0건
- 10개 동시 제출에서도 각 Run의 환경/인수/증거/리포트 혼입 0건
- 동일 Run 도구 실행은 항상 순차 실행
- 대기열 대기 만료와 종료에서 허가 누수 0건

### 메모리

- 가짜 Run 1,000개 장시간 실행 후 최대 RSS <= 256 MiB
- 마지막 Run 500개의 선형 RSS 기울기 <= Run 100개당 1 MiB
- 최종 상태 Run 뒤 에이전트 메시지, 원시 도구 버퍼, 제공자 출력의 잔존 참조 0개
- 증거/도구 원시 바이트 한도를 넘긴 할당이 무제한 증가로 이어지는 표본
  0건

### 신뢰성 및 운영

- 두 에이전트 제공자/각 도구 시간 초과, 네트워크 단절, 부분 실패, 잘못된
  원천/모델/인계 출력, SQLite 쓰기 실패, Discord 거부와 대기열/리포트
  프로세스 중단 구간을 결정적 고정 데이터로 재현
- DB에 쓸 수 있는 시작 과정에서 수신기를 열기 전, 최대 10초 안에 오래된
  `queued`/`running` Run을 설정된 실패 코드로 전환
- 진단/리포트 제공자와 원천 재시도 0, Discord 애플리케이션 수준 재시도 0을
  주입된 가짜 포트 호출 횟수로 증명. Discord SDK 내부 전송 재시도 수는 주장하지 않음
- 모든 수락 Run에서 `request_id -> run_id -> terminal event` 상관관계 확인 가능
- 보존 배치가 설정된 한도를 넘지 않고 활성 Run 삭제 0건
- 개발 환경 롤백 훈련 RTO <= 10분

## 계약 테스트 매트릭스

각 행은 표에 쓰지 않은 필수 설정이 모두 유효하다고 가정한다. Discord 활성 행의
수락된 Run은 시작 성공 뒤 유효한 `/diagnose`를 한 번 호출한 결과다.

| 소유자 | 자극 조건 | 예상 Run | 예상 리포트/아티팩트 |
|---|---|---|---|
| PRD 00/04 | Discord 비활성 + 허용 목록 미설정 + 선택값 없음 | Run 없음, 시작 성공 | 허용 목록은 `dev`, Discord 등록·로그인 0 |
| PRD 00/04 | Discord 비활성 + 허용 목록에 포함된 유효한 선택값 제공 | Run 없음, 시작 성공 | 선택값 검증 성공, Discord 등록·로그인 0 |
| PRD 00/04 | `AMDC_DISCORD_ENABLED`가 빈 값 또는 `true`/`false` 이외의 값 | Run 없음, 시작 중단 | 기본값 대체 0, 모든 네트워크/에이전트 호출 0 |
| PRD 00/04 | Discord 활성 + 허용 목록 미설정 + 선택값 `dev` + 세 자격 증명 존재 | 수락된 Run | 모든 Discord Run이 불변 `dev` 사용 |
| PRD 00/04 | Discord 활성 + 허용 목록 `dev,prod` + 선택값 `dev` 또는 `prod` + 세 자격 증명 존재 | 수락된 Run | 모든 Discord Run이 명시된 불변 환경 하나만 사용 |
| PRD 00/04 | Discord 활성 + `AMDC_ENVIRONMENT` 누락/빈 값/지원하지 않는 값 | Run 없음, 시작 중단 | HTTP 수신/Discord 등록·로그인/에이전트 호출 0 |
| PRD 00/04 | 선택값이 `AMDC_ENABLED_ENVIRONMENTS` 밖에 있음 | Run 없음, 시작 중단 | HTTP 수신/Discord 등록·로그인/원천/에이전트 호출 0 |
| PRD 00/04 | 허용 목록이 명시적 빈 값, `prod`, `prod,dev`, 중복 또는 항목 내부 공백 | Run 없음, 시작 중단 | 기본값 대체/추정 0, 모든 네트워크 호출 0 |
| PRD 00/04 | Discord 비활성 + 제공된 선택값이 비문법 또는 허용 목록 밖 | Run 없음, 시작 중단 | Discord 등록·로그인/원천/에이전트 호출 0 |
| PRD 00/04 | Discord 활성 + 유효한 선택값 + Discord 자격 증명 하나 이상 누락 | Run 없음, 시작 중단 | 누락 키·값 노출 0, 모든 네트워크 호출 0 |
| PRD 00/04 | `/diagnose` 명령 스키마 검사 또는 환경 선택 인수가 포함된 위조 상호작용 | Run 없음 | 등록 스키마에는 `symptom`만 존재, 서버 선택값 변경 0, 에이전트 호출 0 |
| PRD 00/02/04/06 | 환경 문자열이 없는 증상으로 정상 Discord Run 실행 | 계약 상태 유지 | 진단·리포트 모델 메시지, DiagnosisResult, ReportAgentInput, 정본 리포트, Discord 출력, 기본 로그에서 선택 환경 값 일치 0 |
| PRD 00/01 | 지원하지 않는 시나리오 | Run 없음 | 422 `unsupported_scenario` |
| PRD 01/03 | 비밀정보가 포함된 입력 | Run 없음 | 422, 제공자/DB 전달 0 |
| PRD 01 | 접수 포화 | 수락 또는 429 | 수락 요청만 DB 행 보유 |
| PRD 01 | `queued` 커밋 후 프로세스 중단 | 시작 후 `failed` | `server_restarted`, 리포트 없음 |
| PRD 01 | 게시 + 실패 전이 DB 실패 | 프로세스 즉시 중단 | 202 없음, 복구 전 수신 없음 |
| PRD 01 | 접수 중 종료 | 행 없음 또는 `failed` | 허가 정확히 1회 해제 |
| PRD 02 | 지표 양성 + 보조 검사 성공 | `completed` | `problem_detected` |
| PRD 02 | 세 검사 모두 음성 | `completed` | `no_problem_detected` |
| PRD 02 | 도구 시간 초과, 양성 없음 | `completed` | `insufficient_tools` |
| PRD 02 | 도구 실패 + 양성 증거 | `completed` | `problem_detected` + 오류 추적 |
| PRD 02 | 원천 권한 거부, 양성 없음 | `completed` | `needs_permission` |
| PRD 02 | 도구 프롬프트 주입 문자열 | 정책 불변 | 미등록/환경 변경 호출 0 |
| PRD 02 | 개발 Run이 도구 데이터에서 운영 환경 요청 | 정책 불변 | 운영 원천 호출 0 |
| PRD 02/03 | 진단 도구 예산 소진 | `completed` | 결과 해석기 상태, 거짓 음성 없음 |
| PRD 02/03 | 최종 모델 예산 소진 | `failed` | `agent_budget_exhausted`, 리포트 없음 |
| PRD 02/03 | 도구 결과/오류가 0개인 최종화 | `failed` | `invalid_report_generation`, 리포트 없음 |
| PRD 02/03 | 반복 음성 + 오류/결론 불가 | `completed` | `insufficient_tools` |
| PRD 02/06 | 미지원/추가 필드/다른 Run 인계 | `failed` | `invalid_report_generation`; 리포트 제공자/Discord 호출 0 |
| PRD 02/06 | 매핑할 수 없는 발견/원인 근거 한 개 | `failed` | 전체 인계 거부. 항목 누락/제공자/Discord 0 |
| PRD 02/06 | 문제가 아닌 허용 상태 | `completed` | 리포트 에이전트 호출 0, `suspected_cause=null` |
| PRD 03/06 | 양성 증거 + 유효한 리포트 초안 | `completed` | 리포트 에이전트 정확히 1회 호출, 정본 `problem_detected` |
| PRD 01/02/03 | 진단 모델 호출 5회 | 허용된 최종 상태 | 호출 5회 모두 동일 `diagnostic_prompt_version`으로 재구성 |
| PRD 01/03/06 | 문제가 아닌 terminal Run | `completed` | `report_prompt_version=null`, Report 모델 호출 event 0 |
| PRD 01/03/06 | Report binding 커밋 뒤 adapter 시작 전 중단 | 시작 복구 뒤 `failed` | Report 버전 non-null, Report 모델 호출 event 0, 제공자 수신 주장 0 |
| PRD 01/04 | 예상 밖 `runs.prompt_version` 또는 old/new 혼합 schema | 시작/접수 중단 | 자동 변환/추정 backfill/현재 schema 성공 주장 0 |
| PRD 01/03 | 완료 커밋 전 prompt 필드/Report 상태 조합 불일치 | `failed` | Report insert/`completed` 커밋 0 |
| PRD 01/03 | 시작 복구가 이미 terminal인 조합 불일치를 발견 | 시작/접수 중단 | terminal 재전이/정상 Report 주장 0 |
| PRD 03/06 | 리포트 초안이 상태/조치/관찰 결과 추가 | `failed` | `invalid_report_generation`, 리포트/Discord 0 |
| PRD 03/06 | 리포트 제공자 시간 초과 | `failed` | `provider_failure`, 리포트/Discord 0, 재시도 0 |
| PRD 03/06 | 리포트 입력/출력의 비밀정보 | `failed` | 원시 산출물/리포트/Discord 0 |
| PRD 03 | 증거 항목/전체가 바이트 경계에 도달 | 불변 또는 안전한 오류 | 16/64 KiB 불변조건 |
| PRD 03 | 도구/제공자 출력의 비밀정보 | `failed` | 원시 산출물/리포트 없음 |
| PRD 03 | 잘못된 리포트 상태/플래그/null 허용성 | `failed` | `invalid_report_generation` |
| PRD 03 | 누락된 증거/오류 참조 | `failed` | 리포트 저장 0 |
| PRD 01/03 | 실패 Run 증거 조회 | `failed` 유지 | 이전 안전 산출물 정확히 반환 |
| PRD 01/03 | 리포트 삽입/완료 CAS 도중 프로세스 중단 | `running` 또는 `failed` | 부분 리포트/완료 0 |
| PRD 01/03 | SQLite 리포트 쓰기 실패 | 쓰기 가능하면 `failed` | 완료/리포트 응답 0 |
| PRD 03/04 | 가짜 Discord가 호출 순서를 관찰 | `completed` | 영속화된 리포트 읽기 뒤 API 호출 정확히 1회 |
| PRD 03/04 | Discord 투영이 1,900자를 초과 | `completed` | 크기가 제한된 전송 내용 또는 `discord_format_failed`; 리포트 변경 없음 |
| PRD 03/04 | Discord 결정적 거부 | `completed` | 리포트 조회 가능, `discord_delivery_failed`, 애플리케이션 재시도 0 |
| PRD 03/04 | Discord 시간 초과/네트워크/응답 확인 모호성 | `completed` | 리포트 조회 가능, `discord_delivery_unconfirmed`, 애플리케이션 재시도 0 |
| PRD 03/04 | 전달 소유권 확보 뒤 어댑터 예외가 범용 안전 오류 경계에 도달 | `completed` | 전달 이벤트로 종결, 안전 오류 `editReply` 0, 총 API 호출 1 |
| PRD 03/04 | 한 실제 상호작용/프로세스의 중복/지연 콜백 | `completed` | 프로세스 로컬 소유권 확보 승자의 어댑터 호출 최대 1회 |
| PRD 03/04 | 리포트 커밋 뒤 Discord 호출 전 프로세스 중단 | `completed` | 리포트 REST 조회 가능. 목적지 복원/최종 전달 이벤트/재시도 없음 |

각 행은 단위 또는 통합 테스트 이름, 고정 데이터 ID, 최종 DB 단언으로
추적한다.

## 필수 테스트

### 단위 테스트

- 런타임 설정 시작 검증: Discord 활성/비활성 × 허용 목록 × selector
  누락/비문법/비멤버/유효 조합과 네트워크 시작 전 닫힌 실패
- 명시적 가짜 구현 선택
- API 본문/정확한 키/길이/시나리오와 400/413/415/기본 경로 응답 봉투 검증
- Bearer 거부와 실행 시간 안전 비교 래퍼
- 입력 비밀정보 사전 검사
- Run 상태/타임스탬프/오류/리포트 불변조건
- agent별 prompt version의 non-empty/변경 불가 규칙, Report의 한 번만 허용되는
  `NULL -> version` 전이와 terminal null 의미
- prompt 내용 변경 시 version ID 재사용 거부, 시작 시 두 agent의
  version-to-artifact 매핑 검증, queued 뒤 구성 변화에도 Diagnostic artifact/version 고정
- Run lifecycle prompt version key의 필수/explicit null/DB snapshot 일치와
  모델 호출 `agent_role/model_call_index` 연결
- agent 역할별 1부터 증가하는 model call index, tuple 유일성, started/finished pairing,
  반환/throw/timeout/abort와 프로세스 중단에서 finished 의미
- 키 집합 커서 인코딩/디코딩/필터 결합
- 대기열 허가, 상한, 대기 시간 초과, 종료 시 해제
- 도구 레지스트리 깊은 동결, 중복/읽기 전용/환경 거부
- 에이전트/래퍼 금지 가져오기 의존성 규칙 및 변경 불가/불투명 세션 경계
- 도구 코어 입력/문맥/예산/시간 초과/AbortSignal/출력 바이트 강제
- 5xx 결정적 판정 임계값과 낮은 표본/시계열 없음 사례
- Loki/상태 확인 출력 스키마와 데이터 없음/잘못된 형식 매핑
- 증거의 형식화된 전송 내용/출처, 엄격한 RFC 3339/달력/시간 순서 검증기,
  RFC 8785 16/64 KiB 경계
- 정제와 적재된 비밀정보의 정확한 검사, 거짓 양성 고정 데이터
- 정제된 도구 오류 JSON Schema/목록과 알 수 없는 도구 대체값
- 리포트 JSON Schema, 고정 요약/탐지된 문제/후속 조치, 정확한 정본
  관찰 결과 배열, 상태 의미 검증기
- ReportAgentInput, 한 필드 ReportNarrativeDraft, 버전이 있는 ReportAgentOutput의 정확한
  키/동일 Run/참조/크기 검증기
- 리포트 에이전트의 도구 없음/최대 한 번 호출/15초 시간 초과/재시도 0 예산과 가짜 계약
- 영속화된 리포트 전용 Discord 포매터, 전체 전송 내용 1,900자 제한 및
  결정적인 관찰 결과 단위 생략
- 보존 대상의 최종 상태 경과 시간/배치 동작

### 통합 테스트

- POST -> SQLite/대기열 -> 모델 테스트 대역을 사용하는 LangChain 실행기 -> 원천 테스트 대역을
  사용하는 도구 코어 -> 증거 -> 리포트 인계 -> 가짜 리포트 -> 리포트 영속화
  -> GET Run/증거/리포트 -> 가짜 Discord 전달
- 네 가지 리포트 상태 고정 데이터
- 부분 도구 실패 + 양성 증거 우선순위
- 모델 상태 불일치/잘못된 구조화 출력
- 제공자/도구 시간 초과 및 실제 중단
- SQLite 수신 전 시작 복구와 마이그레이션 실패
- Report prompt binding 뒤 adapter 시작 전 중단과 adapter 시작 뒤 시간 초과를
  분리하고 실제 호출별 agent/version을 유일하게 재구성
- 예상 밖 단일 `prompt_version`, old/new 혼합 schema와 backup restore 실패 주입.
  자동 변환 0, worker/listener 시작 0, 접수 0, 수동 무결성 복구 전 자동 재시도 0
- 대기열 포화, 접수 게시/실패 전이 이중 실패, 정상 종료 장벽
- 실패 Run 증거 조회와 안전 산출물 보존
- 리포트 생성 실패와 영속화 이후 Discord 전달 실패 분리
- 영속화된 리포트의 전달 전 읽기 이벤트 순서 및 Discord 한 번 호출 불변조건
- 10,000개 고정 데이터 행의 목록 커서/필터 중복·누락 검증

### 동시성, 장애 주입 및 프로파일링

- 차단된 작업자를 사용한 접수 포화
- 제출 Run 10개의 격리 및 변경 불가 환경
- 동시 콜백 시도에서 원자적 전체/동일 도구 예산
- 시간 초과 후 지연 도구 콜백
- 제공자/원천 네트워크 단절 및 잘못된 응답
- 리포트 입력/출력 스키마 불일치, 제공자 시간 초과와 주입된 비밀정보
- Discord 형식 초과, 거부/네트워크 모호성과 중복 콜백
- SQLite 사용 중/쓰기/리포트 커밋 실패
- DB 삽입/커밋/대기열 삽입/실행/리포트 삽입/완료 CAS 지점의 프로세스 재시작
- 대기 시간 초과/작업자 대기열 제거/종료 경쟁에서 최종 상태 승자와 허가 한 번 해제
- Run 1,000개 RSS 장시간 실행 및 잔존 객체 검사

## 구현 범위

파일/모듈:

- `package.json`, 잠금 파일, `tsconfig.json`: 고정된 런타임 및 테스트 설정
- `src/server.ts`: 시작/종료 및 복구
- `src/app.ts`: Fastify 구성
- `src/app/report-flow.ts`: 먼저 영속화된 Run 문맥을 만든 뒤 기존 공개
  `runDiagnosis()`를 호출하는 정본 애플리케이션 접수/조정 진입점.
  신뢰하지 않는 진단 -> 인계 -> 영속화된 리포트 조정
- `src/config/runtime-config.ts`: 현재 환경 계약 및 즉시 실패 검증
- `src/errors/catalog.ts`: 안전한 API/Run/도구 오류 코드와 메시지
- `src/api/auth.ts`: Bearer 인증
- `src/api/routes/runs.ts`: 생성/목록/조회/리포트 API
- `src/api/routes/evidence.ts`: 정제된 증거/오류 API
- `src/runs/run-service.ts`: 수명주기 및 불변조건
- `src/runs/run-queue.ts`: 허가, 대기열, 작업자, 종료
- `src/runs/run-orchestrator.ts`: 에이전트/증거/리포트 최종 상태 조정
- `src/agent/agent-runner.ts`: 제공자 독립 인터페이스
- `src/agent/langchain-runner.ts`: LangChain `createAgent` 통합
- `src/agent/provider.ts`: 명시적 OpenAI/가짜 어댑터
- `src/agent/prompt.ts`: 버전이 있는 데이터/정책 경계
- `src/report-agent/report-agent-port.ts`: 도구 없는 운영/가짜 인터페이스
- `src/report-agent/langchain-report-agent.ts`: 단일 호출 구조화 출력 어댑터
- `src/report-agent/handoff.ts`: PRD 06의 정확한 버전/동일 Run 호환 어댑터
- `src/report-agent/prompt.ts`: 버전이 있는 정책/데이터 분리
- `src/tools/public.ts`: 동결된 설명자와 불투명 세션 인터페이스
- `src/tools/registry.ts`: 도구 코어의 비공개 정적 등록
- `src/tools/tool-core.ts`: 정본 실행 경계
- `src/tools/backend-5xx-rate.ts`
- `src/tools/backend-error-log-patterns.ts`
- `src/tools/backend-health.ts`
- `src/tools/adapters/fake/*`: 현재 코드 전용 결정적 원천 어댑터
- `src/evidence/normalizer.ts`, `src/evidence/validator.ts`
- `src/reports/assembler.ts`, `src/reports/validator.ts`, `src/reports/outcome-resolver.ts`
- `src/adapters/discord/bot.ts`: 기존 재경 Gateway/Slash Command. 오직
  `handleDiagnoseCommand()`의 Run/임시 형식 호출 사슬과 그 호출을 둘러싼 오류
  경계를 담당자가 검토한 영속화 리포트 흐름 및 단계 인식 전달 경계로 교체한다.
  전달 소유권 확보 전 생성/접수 실패는 고정 안전 오류 응답을 한 번 확보할 수 있지만,
  리포트 전달 소유권 확보 뒤의 예외는 로그/이벤트로 종결하고 두 번째
  `editReply`를 호출하는 범용 예외 처리로 전달하지 않는다.
- `src/adapters/discord/format-report.ts`: 영속화된 정본 리포트 전용 투영
- `src/report/temporary-diagnostic-presenter.ts`: 전환용 호환 접점. 향후
  전환 뒤 제거 여부를 별도 결정
- `src/security/redaction.ts`, `src/security/secret-scan.ts`
- `src/storage/sqlite-repository.ts`, `migrations/*.sql`
- `src/observability/logger.ts`, `src/observability/metrics.ts`
- `schemas/evidence.schema.json`, `schemas/tool-error.schema.json`,
  `schemas/monitoring-report.schema.json`, `schemas/report-agent-input.schema.json`,
  `schemas/report-narrative-draft.schema.json`, `schemas/report-agent-output.schema.json`
- `tests/fixtures/p0`, `tests/unit`, `tests/integration`, `tests/load`

인터페이스/계약:

- PRD 00: 제품/런타임/LangChain 경계
- PRD 01: API, 수명주기, 대기열, 저장소
- PRD 02: 에이전트, 도구, 원천 판정, 결과 해석기
- PRD 03: 증거, 도구 오류, 리포트, 보안, 실패 의미
- PRD 06: ReportAgentInput/Output, 리포트 에이전트 예산, 소유권/재사용 경계

명시적 비목표:

- PRD 00의 모든 비목표
- 추가 장애 시나리오와 동적 플러그인
- PRD 05 확정 전 Prometheus/Loki/Backend 실제 어댑터와 원천 계약 값
- 실제 실패의 고정 데이터 대체 경로
- 운영 결정적 실행기 대체 경로
- 계약에 없는 범용 프레임워크 추상화
- 재경 진단/YAML 런타임 내부 재설계·삭제와 실제 원천 구현
- R0/R1-R5 리포트 작업에서 `src/app/diagnosis-pipeline.ts`, 기존 진단
  `src/agent/**`, 도구 선택/YAML 목록/런타임, 패키징/원천 어댑터 변경
- 애플리케이션 수준 Discord 재시도/재전달, 전달 토큰/원장과 Discord 임베드/다중 메시지

마이그레이션/롤백:

- 기존 `AMDC_ENVIRONMENT` 명시 배포는 키를 바꾸지 않는다. 암묵적 `dev` 기본값
  의존 여부는 값 비노출 방식으로 키 존재만 점검하고, 새 런타임 전에 운영자가
  확인한 환경을 명시한 뒤 허용 목록 멤버십 사전 검증을 통과시킨다.
- 기존 상시 실행 Discord 배포도 새 런타임에서는 `AMDC_DISCORD_ENABLED=true`를
  명시해야 한다. 플래그 누락이나 자격 증명 존재를 활성 의도로 자동 해석하지 않는다.
- 설정을 먼저 명시해 기존 빌드에서도 동작함을 확인한 뒤 새 빌드를 배포한다.
  누락값을 `dev`나 허용 목록의 첫 값·유일한 값으로 자동 보정하지 않는다.
- 첫 전환은 기존 프로세스를 중지한 뒤 새 빌드를 `AMDC_DISCORD_ENABLED=false`로
  기동해 시작 검증과 HTTP 상태를 확인하고, 명시한 선택값·허용 목록·Discord 자격
  증명의 사전 검증이 끝난 다음 `true`로 재기동한다. 안정화 관찰이 끝날 때까지 이전
  검증 빌드와 호환 배포 manifest를 보존한다.
- 마이그레이션 전 WAL 체크포인트와 SQLite 백업 생성·검증
- 마이그레이션은 순방향 전용 번호 파일이며 실패 시 시작/접수 중단
- 첫 P0 schema는 두 agent prompt version column을 직접 생성한다. 예상 밖 단일
  `prompt_version` 또는 부분 schema는 자동 변환하지 않고 별도 migration 결정 전
  시작/접수를 중단한다.
- 배포 롤백은 새 접수 중단 -> 최대 10초 배출 -> 이전 검증 빌드
  재배포 -> 호환 DB 열기 또는 검증된 백업 복원 순서
- 호환되지 않는 스키마에서 이전 빌드를 억지로 기동하지 않음
- 두 agent별 버전을 legacy 단일 `prompt_version`으로 축약하는 down migration 금지.
  이전 빌드는 마이그레이션 전 검증된 백업과 함께만 복원
- 백업 복원 실패 시 DB를 current로 열거나 worker/listener를 시작하지 않고 수동
  복구와 무결성 재검증 전 접수/자동 재시도 금지
- 롤백 뒤 상태 확인, 오래된 Run 복구, 고정 데이터 읽기를 확인한 후 접수 재개
- 가짜/결정적 AgentRunner는 테스트 전용이며 운영 롤백 수단이 아님
- Discord 전달 실패나 불확실 상태에서 롤백/재시작이 자동 재전송하지 않음
- 환경 선택 계약 때문에 롤백하면 먼저 Discord ingress와 실행 프로세스를 플래그와
  독립적으로 중지하고, 이전 검증 빌드와 그 빌드의 호환 배포 manifest를 함께
  복원한 뒤 재기동한다. 이전 빌드는 `AMDC_DISCORD_ENABLED=false`를 Discord 중지
  신호로 해석하지 않으므로 이 플래그만으로 롤백하지 않는다. 명시한
  `AMDC_ENVIRONMENT`와 기존 Discord 자격 증명 참조는 복원 검증이 끝날 때까지
  유지한다.

PR #8은 제품 코드가 아닌 정본 계약과 구현 인계를 변경한다. 따라서 PRD
00/02/04/06과 `docs/prd/current/README.md`의 환경 선택 의미 정합화는 병합 전
필수다. 시작 검증과 런타임 적용은 후속 구현 범위로 이관할 수 있지만, 구현·검증이
끝나기 전 해당
Discord 런타임을 계약 준수 상태로 표시하거나 운영 활성화해서는 안 된다. 특정
리뷰어나 승인 여부는 이 판정의 조건이 아니며 위 계약 테스트 통과가 완료 조건이다.

## 레거시 정리 경계

다음은 현재 테스트나 구현 입력이 아니다.

- `scripts/validate_skeleton.py`
- `scripts/run-amdc-proxy-mcp.sh`
- `config/plugins/**`, `config/keys/**`
- `tests/fixtures/monitoring/**`
- `.claude/**`
- `docs/prd/archive/**`, `dist/archive/**`, MCP hackathon 문서

삭제는 이 PRD의 범위가 아니다. 새 `npm test`와 빌드가 위 경로를 가져오거나
검증 성공 근거로 계산하지 않음을 테스트/설정으로 보장한다.

## 개발 순서

1. Node.js/TypeScript/Fastify/테스트 골격 및 현재 코드 전용 테스트 명령
2. 런타임 설정/오류 목록, 정본 증거/도구 오류/리포트 스키마 테스트
3. SQLite 마이그레이션/저장소와 Run 불변조건
4. 인증, Run/증거 API, 크기가 제한된 대기열 접수/복구
5. 정적 도구 레지스트리/코어와 읽기 전용 도구 계약 테스트 대역
6. 원천 판정, 증거 정규화기, 결과 해석기
7. 가짜 모델을 사용하는 진단 에이전트 수직 흐름 종단 간 테스트
8. PRD 06 인계 스키마/어댑터와 가짜 리포트 에이전트
9. 결정적 리포트 조립기/검증기와 원자적 영속화
10. 영속화된 리포트 전용 Discord 포매터/전달 접점 및 가짜 종단 간 테스트
11. 두 LangChain 실행기와 ChatModel 구조화 출력 테스트
12. OpenAI 제공자 어댑터
13. 동시성, 장애 주입, 메모리/부하 테스트
14. 핵심 롤백 훈련

PRD 05가 승격된 뒤 별도 순서:

15. 원천 계약 스키마/산출물과 기록된 파서 고정 데이터
16. Prometheus/Loki/Backend 개발 환경 어댑터
17. 개발 환경 읽기 전용 간이 점검 및 전체 롤백 훈련

## 완료 경계

핵심 구현 완료:

- 필수 단위/통합/동시성/실패/프로파일 테스트 모음 통과
- 고정 데이터 지표 임계값 충족
- 실제 자격 증명 없이 `npm test` 실행 가능
- 현재 제품 경로의 MCP 참조 0건
- 리포트 에이전트/조립기/Discord 전달 모듈이 진단 YAML/런타임 내부를
  가져오거나 재구현한 경로 0건
- 리포트 생성 실패와 Discord 전달 실패 고정 데이터가 서로 다른 Run/산출물
  결과를 증명
- 가짜 Discord 어댑터 호출은 영속화된 리포트 읽기 뒤 같은 실제 상호작용/프로세스에서
  최대 1회이며 애플리케이션 수준 재시도 0
- 위 핵심 구현 범위의 필수 모듈 존재

데모 준비 완료는 PRD 05 게이트 승격 후에만 판정한다.

Demo 준비:

- 개발 환경 AMDB 읽기 전용 간이 점검 1회 성공
- Run/증거/리포트 재조회와 관찰 결과 추적 시연
- 리포트 스키마/의미/비밀정보 검사 통과
- 검증되고 영속화된 리포트의 Discord 전달과 전달 실패 후 REST 재조회 시연
- 롤백 훈련 기록 존재

필수 아님:

- 운영 환경 간이 점검
- Web UI, Trigger, RAG
- 변경/승인 실행
- 애플리케이션 수준 Discord 재시도/재전달

운영 환경 간이 점검은 별도 명시 승인 없이 실행하지 않는다.
