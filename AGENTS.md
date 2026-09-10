# AMDC 에이전트 가드레일

이 파일은 에이전트 동작을 제어하는 지침이며 README가 아닙니다. 설명, 아키텍처, 스키마와 긴 예시는 `docs/`에 둡니다. `docs/universal-project-agent-contract.md`와 `docs/agent-control-doc-policy.md`를 참고합니다.

## 문서 언어

- 팀이 읽는 문서, GitHub 이슈, PR 본문과 유지관리자 코멘트는 한국어로 작성합니다.
- 코드 식별자, 파일 경로, 명령, API·스키마 필드, enum/status 값, 오류 코드와 버전 문자열은 정확성을 위해 원문을 유지합니다.
- 필수 응답 형식과 구현 인계 블록의 영문 라벨은 자동화가 참조하는 고정 제어 식별자이므로 원문을 유지합니다.

## 게이트

프로젝트 작업에는 PAAR를 사용합니다.

- Problem(문제): 사용자, 병목, 실패 조건 또는 위험
- Analyze(분석): 최소 두 가지 접근법과 실패 모드 비교
- Action(실행): 범위가 제한된 작업, 인터페이스, 비목표, 롤백
- Result(결과): 측정 가능한 성공 임계값과 검증 환경

PAS는 설득 문서와 데모 스토리에만 사용합니다. Problem(문제)은 누가 어떤 구체적 고통을 겪는지, Agitation(악화)은 무엇이 악화되는지, Solution(해결)은 신뢰할 수 있는 최소 AMDC 흐름이 무엇인지 다룹니다.

PAR는 코드 또는 인계 전에 구현을 승인합니다. Problem(문제)은 병목을 명시하고, Analysis(분석)는 최소 두 접근법을 비교하며, Result(결과)는 지표와 테스트로 성공을 입증할 수 있어야 합니다.

PAR가 없으면 구현하지 말고 가장 작은 미결정 입력을 요청합니다.

## 필수 응답 형식

프로젝트 진행, 기능 제안, 구현 요청, 발표/문서 구조 검토에는 다음 순서로 응답합니다.

```text
[Critical Review]
Gate Status: <blocked | ready_for_design | ready_for_implementation | ready_for_verification>
<취약한 가정, 누락된 지표, 설계 위험>

[Trade-off Analysis]
<제안 경로와 1~2개 대안>

[Actionable Next Step]
<결정 질문, 검증 시나리오 또는 구현 인계>
```

## 작업 규칙

- 코딩 전에 생각하고 먼저 점검합니다. 차단하는 미지수만 질문합니다.
- 단순하게 유지합니다. 필요한 최소 변경만 하며 추측성 기능은 추가하지 않습니다.
- 수술적으로 수정합니다. 변경한 모든 줄은 요청 또는 검증된 전제조건으로 추적 가능해야 합니다.
- 행동 전에 목표를 정의합니다. 성공 기준, 비목표, 검증 방법을 정합니다.
- 검증될 때까지 반복합니다. 실패를 수정하거나 구체적인 차단 요인을 보고합니다.
- 재현 가능한 근거 없이 로컬 성공을 프로젝트 성공으로 주장하지 않습니다.

## 필수 로컬 검증

- 의존성 또는 TypeScript 변경 후 `npm run typecheck`와 `npm run build`를 실행합니다.
- 의존성이 없거나 잠금 파일이 변경된 경우에만 `npm ci`를 사용합니다.
- 저장소에는 현재 자동화된 `test` 스크립트가 없습니다. 테스트가 통과했다고 보고하지 말고 이 공백과 가장 좁은 재현 가능한 간이 점검을 제시합니다.
- 단위, 통합, 동시성 검증은 사용자가 실제 환경을 명시적으로 승인하지 않는 한 가짜 제공자와 가짜 도구를 사용해야 합니다.

## AMDC 기본값

- Codex를 기본 프로젝트 작업대로 사용하며 루트 `AGENTS.md`를 정본 제어 지침으로 취급합니다. 명시적으로 요청하지 않는 한 `.claude/` 파일은 이전 버전의 참고 산출물입니다.
- `docs/PROJECT_SETUP.md`가 운영 프로필, GitHub 이슈/PR 작업 흐름, 진행 중 작업 제한, Ready/Done 기준과 검토 경계를 소유합니다. 재검토 조건을 충족하지 않는 한 병렬 추적기나 로컬 상태 원장을 만들지 않습니다.
- `docs/prd/current/README.md`만 정본 P0 진입점입니다. 번호가 매겨진 PRD를 순서대로 읽고 영향을 받은 계약을 소유한 문서를 변경합니다.
- 현재 P0 축: `REST API -> LangChain Diagnostic Agent -> AMDC Tool Core -> sanitized Evidence -> schema-valid Report`.
- P0는 MCP를 사용하지 않습니다. `docs/prd/archive/` 아래 파일과 예전 MCP 설정, 고정 데이터, 스크립트는 참고 산출물일 뿐입니다.
- LangChain은 정적으로 등록된 읽기 전용 도구만 선택할 수 있습니다. 도구 코어가 입력/환경 검증, 호출 예산, 시간 초과, 정제와 실행을 소유합니다.
- 직접 셸, SSH, 제공자 CLI, 임의 SQL/HTTP, 비밀정보 파일 읽기, 배포, 재시작, 삭제와 변경 작업은 P0 경로에서 금지합니다.
- 기본 테스트는 가짜 제공자와 가짜 도구를 사용합니다. 단위, 통합, 동시성 테스트에 실제 AMDB 또는 OpenAI 자격 증명을 요구하지 않습니다.
- 자격 증명, 토큰, 서비스 계정 JSON, 원시 인증 출력, 개인 키, API 키, `.env` 값을 프롬프트, 문서, 로그, 리포트에 노출하지 않습니다.
- AMDC를 “AI가 스스로 운영을 수행한다”가 아니라 안전하고 재현 가능한 조사로 설명합니다.

## 구현 전 지표

지연 시간 p50/p95/p99, 처리량, 동시성, 최대 RSS, 항목별 메모리 증가, 오류율, 재시도 횟수, RTO, 멱등성, 중복 처리, 로그, 경보와 롤백 시간을 고려합니다.

## 극한 조건

경쟁/잠금/재시도 폭주, 제공자 시간 초과/네트워크 단절, 부분 실패, 중복 응답, 주요 경로의 O(N) 탐색, 대기열 적체, 작업자 고갈, 메모리 누수, 권한 실패, 비밀정보 노출, 잘못된 환경 실행, 스키마 불일치, 롤백 실패와 재현 불가능한 로그를 대상으로 인계를 한계 조건까지 검증합니다.

## 구현 인계

`Gate Status: ready_for_implementation`일 때만 다음을 포함합니다.

```text
Implementation Scope:
- Files/modules:
- Interfaces/contracts:
- Explicit non-goals:
- Migration/rollback:

Verification:
- Unit/integration tests:
- Load or concurrency test:
- Memory/profile check:
- Failure injection:
- Success threshold:
```
