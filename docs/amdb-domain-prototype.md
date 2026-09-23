# AMDB 도메인 지식 로컬 실험

`knowledge/amdb-domain.json`은 AMDB 코드 커밋
`c9ed96ac570eeba4167d193f6084510f0572d107`에서 직접 확인한 8개 요약 카드다.
코드 경로와 심볼을 근거로 남겼다. 공통 인프라, 실제 계정/비밀번호,
현재 서비스 건강 상태를 담지 않는다. 전체 AMDB 도메인을 포괄하지 않는다.

## 실행

```sh
node scripts/knowledge-local.mjs start
node scripts/knowledge-local.mjs seed
node scripts/knowledge-local.mjs seed
node scripts/knowledge-local.mjs check
node scripts/knowledge-local.mjs search ProxySQL
```

독립 Compose 프로젝트 `amdc-knowledge-local`, PostgreSQL 17 + pgvector,
호스트 `127.0.0.1:55432`, DB `amdc_knowledge`, 사용자 `amdc_local`.
랜덤 비밀번호는 gitignored `.codex-temp/knowledge-password`에 mode 600으로 생성한다.
볼륨이 존재하는 동안 비밀번호 파일을 삭제/교체하지 않는다.
관리용 로컬 프로토타입이며 에이전트용 최소권한 계정은 아직 만들지 않았다.

중단: `docker compose -f compose.knowledge.yml down` (볼륨 유지).
기존 AMDB/AMDC 서비스의 설정이나 네트워크는 변경하지 않는다.

## 제한

- 현재 검색은 식별자 토큰·한글 2글자 부분어·문서 빈도·제목 가중치를 사용하는 어휘 검색이다. 의미 임베딩 검색은 아니다. 상위 3개, 직렬화한 문자 수 5,000자 이내로 반환한다.
- 현재 코드 커밋의 카드만 PostgreSQL에서 읽고 로컬에서 순위를 계산한다. 최대 1,000개 카드까지만 허용하며 대규모 검색용 구현이 아니다.
- vector 확장과 연산만 검증한다. 임베딩 모델 미선정으로 실제 embedding은 NULL이다.
- 진단 LangChain이나 Discord에는 아직 연결하지 않았다.
- 실행 결과 캐시, 실행 원장, 온톨로지는 포함하지 않는다.
- 같은 ID/커밋 재적재는 갱신하며 중복되지 않는다. 요약 수정 시 벡터는 무효화한다.
- 임베딩 버전 관리, 원문 자동 수집, 문서 삭제 처리, 검색 성능 평가는 후속 범위다.
- `pgvector/pgvector:pg17`은 이동 태그다. 운영 전 digest 고정이 필요하다.

pgvector 설치·vector 연산은 https://github.com/pgvector/pgvector 문서를 따른다.

## 로컬 확인 결과 (2026-09-18)

- 새 컨테이너 healthy, 데이터 8개 적재 성공.
- seed 2회 실행 후에도 8개로 유지.
- ProxySQL / mysql_db_name / Redis 키워드 조회 및 출처 반환 확인.
- pgvector 거리 연산 통과. 실제 임베딩은 0건이며 의미 검색 검증은 아님.
- 8개 카드의 코드 출처 11개를 해당 Git 커밋의 파일·심볼과 대조.
- 기존 AMDC 테스트 50개 및 타입 검사 통과.

## 검색 개선 실험

```sh
node scripts/knowledge-local.mjs seed
node scripts/knowledge-eval.mjs
# 선택: 설정된 모델 4회 호출, 실제 운영 도구 실행 없음
node scripts/knowledge-eval.mjs --live
# 선택: 검색어 변환 실험, 최대 모델 5회 호출
node scripts/knowledge-paraphrase-eval.mjs
```

- 이름 생성식의 `_`와 연결 메트릭의 `username=mysql_db_name` 관계를 명시했다.
- 직접 작성한 자연어 질문 12개는 기존 전체문자열 검색 0/12에서 어휘 검색 상위 3개 기준 12/12로 개선됐다. 독립 벤치마크는 아니다.
- 범위 밖 질문 3개는 검색 결과 없음. 모든 무관 질문을 거부한다는 보장은 아니다.
- 도구 선택 단일 턴 평가: MySQL 2건과 ProxySQL 1건은 실제 스키마·기대 입력 일치. Prometheus 1건은 메트릭 목록을 먼저 선택하여 후속 값 조회는 미평가. 실패로 단정하거나 4/4 성공으로 계산하지 않는다.
- 모든 모델 평가는 합성 식별자를 사용한 도구 선택 실험이다. 실제 플러그인 선택부터 시작하는 진단 전체나 실제 tool execution을 검증한 것은 아니다.
- 다른 표현의 추가 질문에서 어휘 검색 누락을 발견했다. 검색어 LLM 변환만으로는 충분하지 않아 기본 검색에 자동 연결하지 않았다. 변환에는 추가 지연·토큰이 들며 검색어는 증거로 간주하지 않는다.
- 재현 결과는 gitignored `.codex-temp/knowledge-eval.json`, `.codex-temp/knowledge-paraphrase-eval.json`에 남긴다. 새 실행은 이전 평가 파일을 교체한다.
