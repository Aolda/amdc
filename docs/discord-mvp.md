# Report Agent · Discord 1차 MVP

팀 진단 원장을 검증해 보고서를 작성·저장하고 Discord에 요약과 Markdown을 보낸다. 가짜 연결 자동 검증은 통과했으며 실제 모델·Discord 수신은 아래 검증 현황에 따로 기록한다.

## 실행 흐름

```text
Discord /diagnose symptom:<증상>
→ 팀 LangChain 진단 에이전트 → DiagnosisHandoff
→ Report Agent 원인 가설 + 서버의 기록·한계 조립
→ 검증 → 파일 저장 → 재조회 → Discord 요약 + amdc-report.md
```

인계 계약은 [PRD 06](prd/current/06-diagnostic-agent-tool-runtime.md#1차-mvp-진단-원장-인계),
출력·저장·전달 계약은 [PRD 03](prd/current/03-evidence-report-security.md#1차-mvp-리포트와-discord-전달)이 소유한다.
별도 `diagnosis-report/1.0.0`을 사용한다. 기존 Backend 5xx V1, REST, SQLite Run 전체 구현과는 범위가 다르다.

## 빠른 로컬 검증

Node.js 20 이상과 PowerShell을 사용한다.

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run smoke:report
```

기본 스모크는 실제 `DiagnosisLedger`의 합성 기록과 가짜 모델을 사용한다.
MySQL 잠금 조회 성공과 트랜잭션 조회 권한 실패를 함께 담으며 외부 서비스는 호출하지 않는다.
출력 경로 `.codex-temp/report-smoke/<diagnosis_id>/`에서 JSON, Markdown, Discord 미리보기를 확인한다.

실제 보고서 모델만 확인하려면 로컬 `.env`를 설정한 뒤 실행한다.
이 명령도 진단 자료는 합성이며 실제 DB나 서버를 조회하지 않는다.

```powershell
npm run smoke:report -- --live-model
```

## 모델과 Discord 설정

처음 설정할 때만 `.env.example`을 `.env`로 복사한다. 기존 `.env`는 덮어쓰지 않는다.
비밀 값은 Git, 문서, 보고서, 대화에 넣지 않는다.

| 설정 | 용도 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI 또는 OpenAI 호환 게이트웨이의 테스트 키 |
| `OPENAI_BASE_URL` | 게이트웨이에서 안내한 API 주소 |
| `AMDC_AGENT_MODEL` | 해당 키가 접근 가능한 모델 이름 |
| `DISCORD_TOKEN` | 테스트 봇 토큰 |
| `DISCORD_CLIENT_ID` | Discord Application ID |
| `DISCORD_GUILD_ID` | 봇을 설치한 **서버 ID** |
| `AMDC_ENVIRONMENT` | 로컬 시험은 `dev` |
| `AMDC_DIAGNOSTIC_RUNNER` | 연결 안내만은 `mock`, 실제 진단·보고서는 `langchain` |
| `AMDC_REPORT_DIRECTORY` | 기본 `./data/reports` |

Discord 개발자 포털에서 테스트 애플리케이션과 봇을 만든 뒤 `bot`,
`applications.commands` 범위로 테스트 서버에 설치한다. 보고서 전송에는
채널 보기·메시지 전송·파일 첨부 권한이 필요하다. Message Content Intent는 사용하지 않는다.

```powershell
npm run dev
# 또는
npm run build
npm start
```

시작 시 설정 서버에 `/diagnose`를 등록한다. Discord의 해당 서버에서 명령을 실행하면 된다.
`langchain`으로 실제 진단까지 실행하려면 팀의 읽기 전용 소스 설정도 필요하다.
`.env.example`의 예시 URL은 실제 운영 설정이 아니며 확인 없이 운영 소스에 연결하지 않는다.

팀원의 [Discord 연동 노트](https://app.notion.com/p/3b0a7bacf95580d198a3f243f04a7b94)를 따라
discord.js Gateway와 길드 명령 등록을 유지했다. `DISCORD_GUILD_ID`는 채널 ID가 아니다.

## 저장과 실패 확인

저장소는 같은 파일 시스템의 원자적 hard link를 지원해야 한다.
Docker Compose는 `report-data` 볼륨을 `/app/data/reports`에 연결한다.
이미지에는 검증 스키마도 포함한다. Docker 실행 자체의 검증 여부는 아래 현황을 따른다.

모델·형식·저장 실패에는 보고서 첨부가 없다. 전송 확인 실패 후 자동으로 다시 보내지 않으므로
서버 이벤트의 `diagnosis_id`로 저장된 보고서를 확인한다. 프로세스 재시작을 넘는
중복 처리, REST 조회, 전체 Run 저장소, 큐·운영 복구는 이번 MVP 범위 밖이다.

원시 문자열과 비밀정보 차단은 방어선이지 자유문 해석의 사실성 보증은 아니다.
특히 PR #11 진단 모델이 받는 원시 SQL/원천 결과는 이번 Report 경계와 별개의 상위 검토 항목이다.

## PR 통합과 검증 현황

2026-09-27 로컬 통합 브랜치 기준:

| 팀 변경 | 통합한 head |
| --- | --- |
| PR #11 진단 도구 | `f8b90d6c578d2b59b756a7a49bf2ee074f93badf` |
| PR #14 진단 인계 | `6955183748759585a0e94aecff7a1a5e4fd9ed0d` |
| PR #15 지식 DB 시제품 | `d00733dc18b9a83ac12b7da6e9b2dd65c2efcb74` |
| PR #16 CI 병합 검증 | `d2389cac03d2723f5552fa39cfc8af6e7c2dd28c` |

이는 로컬 기능 브랜치에 반영한 상태다. GitHub의 PR 병합·배포를 뜻하지 않는다.
PR #15 지식 DB 시제품은 포함되어 있으나 보고서 런타임의 RAG로 연결하지 않았다.

- 자동 검증: 타입 검사·빌드 통과, 테스트 215개 통과·1개 건너뜀.
- 흐름 검증: 저장 후 재조회, 성공·오류 혼합, 10건 동시 격리, 중복 요청 차단,
  저장·모델 실패, 비밀정보·원시 행 복사 차단, 모델 절대 기한, SDK 503 단일 시도.
- 가짜 모델 스모크: 약 13ms의 단일 로컬 관측. 서비스 지연이나 부하 성능 보장이 아니다.
- 실제 모델: 학교 LiteLLM 테스트 키로 합성 원장 → 보고서 생성·저장·재조회·형식화 통과.
  한국어 최종 스모크는 약 3.3초, 앞선 호출은 약 14.3초로 관측했으며 지연 보장이 아니다.
  제공자 스키마에는 지원되는 구조만 보내고
  응답은 로컬 전체 스키마로 다시 검증한다.
- Discord 수신: 코드와 가짜 전송 검증 완료. 개발자 포털 로그인·테스트 서버 지정 후
  새 테스트 봇 생성과 실제 수신 확인이 남아 있다.
- Docker 실행, 실제 운영 소스, 장시간 메모리·부하 측정: 미검증.

롤백은 봇 프로세스를 종료하고 이전 기능 브랜치로 돌아간다. 기존 보고서 파일은 보존한다.
단순 연결 확인이 필요하면 `mock`으로 전환하되 이 결과를 진단 성공으로 해석하지 않는다.
