# AMDC (Automated Monitor & Debugger with Claude)

## 프로젝트 개요

서비스 운영 모니터링, 디버깅, 해결을 AI로 자동화하는 오픈소스 파이프라인.
Human in the Loop 방식으로 운영자가 주도권을 가지면서 AI의 도움을 받는 구조.

1차 적용 대상은 AMDB (학생 운영 비영리 managed database 서비스).

## 핵심 파이프라인

```
Data Source → Trigger(Rule 충족) → Agent 호출 → Staging 검증 → Report 제출 → 운영자 승인 → Prod 실행
```

## 아키텍처 구성

- **AMDC Server (Node.js)**: API, MCP, Trigger, Terminal(xterm.js), Agent 관리를 모두 담당
- **Claude Code Subprocess**: 서버가 spawn하는 CLI 프로세스. 여러 세션 동시 실행 가능
- **Admin Page (Frontend)**: 운영자용 웹 페이지. Report 확인, AI 대화, 승인/반려, 설정 관리
- 아키텍처 구상도: `docs/architecture.drawio`

## Trigger

- 플러그인 구조. 코드 수정 없이 YAML로 설정 가능
- 데이터 소스 4가지 유형: Metrics, Logs, Events, State
- 수집 방식: Pull (REST API) + Push (Webhook)
- Rule 유형: 기본 조건, 복합 조건 (AND/OR, 시간 윈도우), API 호출 조건 (ML 모델 등)
- Trigger 설정 시 호출할 agent와 감지 목적(description)을 지정

## Agent

- agent.md(지침) + skills(세부 작업) + 허용 MCP tool로 구성
- 유형: Built-in (시스템 내부용, 수정 불가), Default (모니터링/QA, 수정 가능), Custom (사용자 정의)
- Skill과 Tool Plugin은 1:1 매핑
- 모든 agent에 공통 시스템 프롬프트 주입 (보고서 최소 규격)

## MCP

- AMDC MCP Server가 Claude Code와 Target Service 사이의 중간 레이어
- 모든 tool 호출 시 하네스에서 session-id, agent-type, environment(staging/prod) 자동 주입
- Permission: report를 참조하여 승인 여부 판단 (IAM 방식 아님)
- Tool 위험도 3단계: Level 1(항상 승인) / Level 2(prod만 승인) / Level 3(자동 허용)
- Agent별로 사용할 plugin 선택, 위험도 레벨 커스텀 가능 (올리기/낮추기 모두)

## Tool Plugin

- 외부 도구를 AMDC MCP tool로 wrapping하는 플러그인 구조
- 유형: MCP Wrapper, CLI Wrapper, Custom Script
- 코드 기반 개발, 메타데이터는 선언적 정의
- Lazy Loading: 시작 시 전체 로딩 안 함, skill 사용 시 관련 tool 로드

## Environment 전환

- Staging에서 먼저 검증 → 검증 결과 포함 report 제출 → 운영자 승인 → Prod 실행
- 권한은 보고서 단위로 갱신

## 인프라 컨텍스트

- MCP를 통해 인프라 스캔 → AMDC 서버(파일/DB)에 저장 → 이후 세션에서 재활용
- 작업 중 차이 감지 시 컨텍스트 관리 subagent가 업데이트

## LLM 런타임

- CLI 도구 (Claude Code, Codex): 자체 하네스 활용, agent.md/skills 파일 배치, MCP만 AMDC 경유
- 직접 API (GPT, 오픈소스): AMDC가 하네스 제공 (agent.md→프롬프트, skills→tool 정의)
- 같은 설정으로 어떤 런타임이든 동작

## 데이터 저장

- 설정 (Trigger/Rule/Agent/MCP/DataSource): 파일 (YAML/JSON)
- Report, 세션 로그: 파일 (1차) → DB (추후)
- 인프라 컨텍스트: AMDC 서버 파일/DB

## 기술 스택

- Server: Node.js
- Frontend: React (예정)
- Terminal: xterm.js + WebSocket
- LLM: Claude Code CLI (1차)

## 브랜치 전략

- `main`: 안정 버전
- `develop`: 개발 브랜치

## 개발 컨벤션

### TDD (필수)

- 반드시 테스트를 먼저 작성하고, 그 다음 구현한다 (Red → Green → Refactor)
- 테스트 없는 코드는 커밋하지 않는다
- 테스트 프레임워크: Vitest

### 코드 품질

- `any` 타입 사용 금지 (ESLint strict로 강제)
- 함수는 50줄 이내로 유지
- 파일은 200줄 이내로 유지
- ESLint + Prettier 통과 필수 (pre-commit hook으로 자동 검사)
- 테스트는 pre-push hook으로 자동 실행

### 코드 작성 원칙

- 새 파일을 만들기 전에 기존 유틸리티, 패턴, 컴포넌트를 먼저 탐색하고 재사용한다
- 요청받은 것만 구현한다. 과도한 추상화, 불필요한 기능 추가 금지
- 에러 핸들링은 시스템 경계(사용자 입력, 외부 API)에서만 수행한다. 내부 코드에 방어적 검증을 넣지 않는다
- 한 커밋에는 하나의 기능 변경 + 관련 테스트를 포함한다

### 디렉토리 구조

```
server/src/          # Express 서버 소스
  routes/            # API 라우트
frontend/src/        # Next.js 프론트엔드 소스
  app/               # App Router 페이지
```

### 실행 환경

- 서버는 항상 `docker compose`로 실행된다
- DB 파일은 Docker 볼륨(`amdc-data`)에 저장된다
- 코드 변경 후 반영: `docker compose up -d --build`

### DB 마이그레이션 (Drizzle)

- 스키마 변경 시 기존 마이그레이션 파일을 절대 삭제하지 않는다
- `drizzle-kit generate`로 새 마이그레이션을 추가한다 (기존 것 위에 증분)
- DB 데이터는 삭제하지 않는다. 항상 마이그레이션으로 스키마를 변경한다
- 기존 마이그레이션을 삭제하고 재생성하면, 이미 적용된 DB와 마이그레이션 이력이 충돌하여 500 에러가 발생한다

### 기술 스택 상세

- 패키지 매니저: pnpm (워크스페이스)
- 린트: ESLint (strict + sonarjs)
- 포맷: Prettier
- 테스트: Vitest
- Git Hooks: Husky + lint-staged

## 설계 문서

상세 설계는 Notion에서 관리:

- AMDC design docs (메인)
- Trigger 설계
- Agent 설계
- MCP 설계
