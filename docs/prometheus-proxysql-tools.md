# Prometheus and ProxySQL read-only tools

Tool definitions (description, input schema, HTTP endpoint or SELECT, filters and
environment bindings) live in `src/tools/catalogs/amdb-tools.yaml`. TypeScript
implements the common transport, validation, timeout and result envelope. The
agent initially sees plugin descriptors and `select_plugin`; selecting another
plugin replaces the visible tools without removing previous observations.

## Prometheus

| Tool | Required inputs | Returned source data |
| --- | --- | --- |
| `prometheus_get_targets` | None | Active targets, scrape health and errors |
| `prometheus_list_metric_names` | None | Stored metric names, possibly including inactive series |
| `prometheus_get_metric_metadata` | `metricName` | Metric type, help text and unit |
| `prometheus_get_metric_series` | `metricName`, `start`, `end` | Label sets in an interval |
| `prometheus_get_metric_value` | `metricName` | Instant evaluation labels, timestamps and values |
| `prometheus_get_metric_range` | `metricName`, `start`, `end` | Step evaluations over an interval |

Value, range and series readers above have no label inputs. Each also has a
`_by_instance` and `_by_database` variant, requiring exactly one `instance` or
`databaseName` (the `database` label). Other label combinations are not exposed.
Filtered value/range calls first check matching series within the same interval
(instant calls use the preceding five minutes). No matching series returns
`invalid_input` with an explicit not-observed message, not a service-fault claim.
This extra read shares the original timeout; metadata may exist without samples.
Successful sample responses can therefore still be empty. No snapshots or
reference registry are introduced. The agent cannot submit PromQL, a URL or an
HTTP path. The adapter constructs one metric selector and quotes each label value
as a PromQL string literal. It does not calculate rates, ratios, severity or causes.

Times use UTC RFC3339. Instant `time` defaults to the run reference time. Series
and range intervals are at most 24 hours. Range `stepSeconds` defaults to 60,
accepts 15–3600, and permits at most 1441 evaluations per series. Range queries
return evaluation timestamps, not every original scrape sample. Series metadata
does not prove that samples exist throughout a requested interval.

The HTTP body is returned unchanged after successful-response validation and the
existing secret scan. HTTP error bodies are not returned. The 64 KiB byte limit
applies to actual streamed bytes; excessive responses return `tool_output_too_large`
instead of silently dropping series. Empty results do not establish good health.
Names and metadata come from the configured source, not a hardcoded metric list.

Within one diagnosis, the LangChain wrapper rejects a repeated tool name and
identical arguments before source execution, including parallel duplicates.
A new diagnosis can read fresh data. This avoids repeated I/O but does not
guarantee that a model will stop requesting a rejected call.

AMDB's checked-in scrape configuration collects `mysql`, `proxysql`,
`node-exporter` and `amdb-custom`. Its custom exporter includes database sizes and
user/database query and connection counters. The label filter reads these
existing series; it does not invent a mapping from AMDB account IDs to usernames.

## ProxySQL

| Tool | Scope |
| --- | --- |
| `proxysql_get_connection_pool` | All backend pool rows |
| `proxysql_get_connection_pool_by_hostgroup` | Required `hostgroup` |
| `proxysql_get_users` | Frontend connection count and limit by username |
| `proxysql_get_all_processlist` | All frontend sessions |
| `proxysql_get_processlist_by_database` | Required `databaseName` |
| `proxysql_get_processlist_by_user` | Required `username` |
| `proxysql_get_processlist_by_session_id` | Required `sessionId` |
| `proxysql_get_query_digests` | Accumulated normalized query statistics |
| `proxysql_get_query_digests_by_database` | Required `databaseName` |
| `proxysql_get_query_digests_by_user` | Required `username` |
| `proxysql_get_errors` | Error codes, counts and first/last timestamps |
| `proxysql_get_command_counters` | SQL command counts and total durations |
| `proxysql_get_global_status` | Runtime status names and original values |

Use the Admin port (6032) and a dedicated `admin-stats_credentials` account.
Configuration and password-bearing tables are not queried. No `_reset` table is
allowed: those tables mutate counters even when read with SELECT. Explicit column
lists exclude credentials, free-text error payloads and extended session JSON.
Current SQL and normalized digest text are bounded to 4096 characters.

ProxySQL Admin does not support MySQL binary prepared statements. The common SQL
reader therefore uses a separate text-protocol connector, with SQLite single-quote
escaping for string literals and integer-only numeric values. MySQL escaping
(backslash quotes) is not used for ProxySQL. SQL text, table names, projection and
ordering are fixed in YAML, and unknown/invalid inputs are rejected before I/O.
The catalog restricts ProxySQL to explicit SELECTs from non-reset stats tables.
It remains a trusted developer-owned catalog, not an arbitrary SQL sandbox.

`SessionID` identifies a ProxySQL frontend session and is not a MySQL backend
connection ID. Pool connections can be reused across sessions. Digest durations
are microseconds; first/last timestamps are Unix seconds. These are accumulated
counters rather than a history of individual statements. Error codes do not
include raw error messages. Stats queries do not reset any counters.

Each read opens and closes its own connection, fetches limit+1 rows and returns
`rows`, `returnedRows`, `truncated`, `limit`, `appliedFilters` and `collectedAt`.
Default limit is 100, maximum 200. Transport remains `mysql` (wire protocol) while
source is `proxysql`. A 5-second deadline and 64 KiB selected-result limit apply.
Production requires CA-verified TLS; only local development was live-tested.

## Local reproduction

Configure the stats-only credentials using the variable names in `.env.example`.
Do not use an administrative account as the tool reader. The scripts below force
the tool endpoints to localhost, require explicit opt-in and do not call an LLM.

```sh
npm test
npm run typecheck
npm run build
AMDC_LOCAL_MONITORING_TEST=1 node scripts/monitoring-live-check.mjs
AMDC_LOCAL_MONITORING_TEST=1 node scripts/monitoring-fault-check.mjs
AMDC_LOCAL_MONITORING_TEST=1 node scripts/prometheus-outage-check.mjs
```

On macOS set `AMDC_TEST_DOCKER=/Applications/Docker.app/Contents/Resources/bin/docker`
if Docker is not in PATH. The fault check expects the existing local AMDB containers
`amdb_backend`, `mysql_1` and `proxysql`, with ports 33061/3306/6032 exposed. It
creates two uniquely named databases and users, injects a bounded row-lock wait
and an invalid-table query, checks filters/digests/errors and removes the fixtures
in `finally`. Historical diagnostic counters and Prometheus samples remain until
normal retention. The outage check stops only `mysql-exporter`, restarts it in
`finally`, and checks target failure, `up=0`, recovery and historical range data.

Local verification on 2026-09-17: all 19 Prometheus/ProxySQL tools executed;
12 concurrent ProxySQL reads succeeded; isolated DB/user/session filters, literal
injection handling, row-wait pool usage, query digests, error counters and session
cleanup passed. This is tool execution evidence, not a claim about LLM diagnosis
quality, production latency, or resolution of the earlier MySQL fan-out failure.

After splitting Prometheus inputs on 2026-09-17: 49 automated tests, typecheck
and build passed. The localhost smoke executed all 12 Prometheus and 13 ProxySQL
tools (26 reads including a repeated series discovery), rejected an unobserved
instance, and passed 12 concurrent ProxySQL reads. Smoke p50/p95 were 3/12 ms;
process RSS was 109 MiB (one smoke observation, not a memory-growth test).

Live diagnosis `c0136c2a-9f0c-47f9-8fe4-234dd986edb7` asked
“최근 10분 동안 MySQL 연결 수가 어떻게 변했어?” through the Discord diagnosis
pipeline. It selected Prometheus, listed metric names, then read targets,
metadata and an unfiltered range. The range returned one series and 11 points;
the report stated that connections stayed at 7. Four model calls completed in
24.284 seconds, with no duplicate request or tool error. The formatted report
was sent to the local test bot's `amdc` channel. This single successful run
demonstrates the original reproduction passing, not general model reliability.

References: [Prometheus HTTP API](https://prometheus.io/docs/prometheus/latest/querying/api/),
[ProxySQL stats tables](https://proxysql.com/documentation/the-admin-schemas/stats/stats-mysql/),
[ProxySQL admin variables](https://proxysql.com/documentation/global-variables/admin-variables/).
