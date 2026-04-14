---
name: grafana-alert
description: Grafana에 Alert Rule을 생성하고 AMDC Scenario webhook과 연결합니다
---

# Grafana Alert 생성 + AMDC Scenario 연결

사용자의 요청에 따라 Grafana에 Alert Rule을 생성하고, 기존 AMDC Scenario의 webhook으로 연결합니다.

## 입력

- Grafana URL (예: http://localhost:3000)
- AMDC Server URL (예: http://localhost:4001)
- AMDC Server의 Docker 내부 접근 주소 (예: http://host.docker.internal:4001)

## 실행 절차

### 1. 환경 확인

```bash
# Grafana 상태
curl -s {GRAFANA_URL}/api/health

# Grafana Datasource 목록
curl -s {GRAFANA_URL}/api/datasources

# AMDC Scenario 목록
curl -s {AMDC_URL}/api/scenarios
```

### 2. 사용자에게 확인

- 어떤 AMDC Scenario와 연결할지 선택
- 어떤 조건으로 alert를 발생시킬지 (메트릭, threshold 등)
- 어떤 Grafana datasource를 사용할지

### 3. Contact Point 생성

선택한 Scenario의 webhook을 Grafana Contact Point로 등록:

```bash
curl -s -X POST {GRAFANA_URL}/api/v1/provisioning/contact-points \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "AMDC - {scenario_name}",
    "type": "webhook",
    "settings": {
      "url": "{AMDC_DOCKER_URL}/api/webhooks/{scenario_id}",
      "httpMethod": "POST",
      "authorization_scheme": "Bearer",
      "authorization_credentials": "{auth_key}"
    }
  }'
```

### 4. Notification Policy 설정

기존 policy를 GET으로 조회 후, routes에 추가:

```bash
curl -s -X PUT {GRAFANA_URL}/api/v1/provisioning/policies \
  -H 'Content-Type: application/json' \
  -d '{기존 policy에 route 추가}'
```

### 5. Alert Rule 생성

folder가 없으면 먼저 생성. 사용자 요청에 맞는 PromQL/LogQL로 Alert Rule 생성.
labels에 `"amdc_scenario": "{scenario_name}"` 반드시 포함.

### 6. 검증

- 생성된 Alert Rule 확인
- Contact Point 확인
- 결과 요약

## 주의사항

- Scenario는 이미 존재해야 합니다. 없으면 먼저 AMDC 웹에서 만들도록 안내하세요.
- PromQL 쿼리 작성 전 사용 가능한 메트릭을 확인하세요.
- threshold 값은 반드시 사용자에게 확인받으세요.
- **Alert Rule의 data는 반드시 3단계로 구성해야 합니다:**
  1. `A` (query): PromQL/LogQL 쿼리 → time series 반환
  2. `B` (reduce): `type: reduce`, `expression: A`, `reducer: last` → 단일 값으로 축소
  3. `C` (threshold): `type: threshold`, `expression: B` → 조건 판단
  - Reduce 없이 query → threshold로 직접 연결하면 "looks like time series data, only reduced data can be alerted on" 에러가 발생합니다.

$ARGUMENTS
