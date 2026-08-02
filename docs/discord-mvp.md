# Discord MVP

## Scope

This MVP keeps Discord as a thin input/output adapter.

```text
Discord /diagnose
  -> symptom input
  -> runDiagnosis()
  -> DiagnosticRunner
  -> Discord report response
```

The current implementation only supports `AMDC_DIAGNOSTIC_RUNNER=mock`.
`AMDC_DIAGNOSTIC_RUNNER=langchain` is reserved for the next LangChain issue.

## Slash Command

```text
/diagnose symptom:<problem description>
```

`target` is intentionally excluded because AMDB service boundaries are not fixed
yet.

## Environment

Runtime environment and runner selection are server-owned configuration.

```env
AMDC_ENVIRONMENT=dev
AMDC_DIAGNOSTIC_RUNNER=mock
```

Discord credentials must stay in `.env` and must not be committed.

## Local/VM Run

```bash
cp .env.example .env
docker compose up --build
```

Required `.env` keys:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
AMDC_ENVIRONMENT=dev
AMDC_DIAGNOSTIC_RUNNER=mock
```
