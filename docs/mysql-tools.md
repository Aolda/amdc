# Direct MySQL diagnostic tools

The mysql plugin includes parameterized read-only MySQL operations and a no-input lock overview.
YAML owns each tool's input schema, fixed SELECT, optional filter predicates,
binding order, defaults, dependencies, ordering and environment-variable prefixes.
The `mysql_sql` executor in `src/tools/source-adapters/mysql-adapter.ts` contains
no tool-name dispatch or tool-specific SQL. It binds values through mysql2 prepared
statements; values never become SQL identifiers or clauses. Boolean options such
as includeIdle select a YAML-declared predicate via its `when` value.
Catalog definitions are trusted executable configuration: review their SQL and
use a least-privilege diagnostic account. SELECT syntax checks are not a SQL sandbox.

| Tool | Filters | Scope |
|---|---|---|
| mysql_get_all_lock_waits | None | Unfiltered InnoDB data-lock wait edges, capped at 100 with truncation flag |
| mysql_list_schemas | namePrefix, limit | Non-system schemas visible to the diagnostic account; literal prefix, not LIKE wildcards |
| mysql_get_processlist | schema, connectionId, includeIdle, limit | Foreground connections except this query; schema means connection default schema; idle excluded by default |
| mysql_get_transactions | connectionId, transactionId, limit | Active InnoDB transactions, oldest first; default schema is informational, not transaction ownership |
| mysql_get_lock_waits | schema, table, connectionId, limit | InnoDB data-lock wait edges; schema/table refer to locked objects; connection may be on either side |

All filters are optional and combined with AND. `table` requires `schema`.
`mysqlUser` remains in returned rows but is not accepted as an input filter.
IDs are decimal strings, including returned connection and transaction IDs.
Input ID schemas enforce 1–20 decimal digits; limits use JSON Schema integer.
The table-to-schema dependency is documented in the field description and enforced
by the MySQL adapter; it is not expressed as a conditional JSON Schema constraint.
Each query fetches limit+1 rows; default limit 100, maximum 200. Results include
rows, returnedRows, truncated, collectedAt, appliedFilters and the effective limit.
appliedFilters records supplied filters plus the processlist includeIdle default;
fixed scope restrictions from the table above still apply.
SQL text is capped at 4096
characters with statementTruncated. SQL text can contain application data;
existing-style secret scanning rejects known configured secrets and key/bearer
patterns, but is not general PII redaction. Do not persist raw results in traces.
LOCK_DATA is deliberately not selected.

For example, `mysql_get_processlist({})` reads without optional identity filters;
`mysql_get_processlist({"schema":"sg"})` filters the connection default schema.
Empty rows mean no matches within the applied scope at collection time, not proof
that the server is healthy.

Each call opens a dedicated connection and destroys it on completion, cancellation
or timeout. A connection arriving after timeout is immediately destroyed. The
server receives MAX_EXECUTION_TIME as well as the client deadline. Reads have a
5-second deadline and 64 KiB serialized result cap. The cap is checked after
fetching the bounded row count; it is not a streaming byte cap. Separate queries
are not one consistent snapshot; threads/transactions may disappear between reads.

## Connection setup

Use AMDC_DEV_MYSQL_HOST/PORT/USER/PASSWORD, or their PROD counterparts.
Production requires AMDC_PROD_MYSQL_TLS_CA containing the trusted CA PEM and
enables certificate verification. Connect directly to user MySQL, not the
ProxySQL client/admin port or metadata MySQL. Local Compose publishes user MySQL
at 33061; the mysql service's internal port is 3306. Hostnames depend on where AMDC
runs. No application/root/exporter credentials are automatically reused.

Provision a dedicated account with the required SELECT access to Performance
Schema and PROCESS visibility for INNODB_TRX, and verify its schema visibility.
SCHEMATA only lists schemas visible to the account: an empty result is not proof
that no database exists. Account creation/grants are a separate deployment step.
Unsupported tables/columns return source_unavailable; permission failures return
source_permission_denied. Neither becomes an empty successful result.

## Verification and remaining live checks

For an explicit local Docker integration check, rebuild the AMDC image and run
`AMDC_LOCAL_MYSQL_TEST=1 node scripts/mysql-live-check.mjs` with Docker on PATH.
This uses the existing local `mysql_1` root environment only for an isolated
fixture and the AMDC diagnostic account for tool reads. It creates a temporary
schema/account, checks filters, lock relationships, idle visibility, truncation,
invalid inputs and recovery, then removes its fixture. It never calls an LLM.

Automated tests exercise fixed query bindings, prefix semantics, bidirectional
lock filters, invalid inputs, limits, raw output, secret/size rejection, permission
errors, deadline cleanup including late connections, and 12 concurrent fake calls.
They do not establish live SQL compatibility or live server overhead.

Before deployment, execute all five through the actual runtime using a diagnostic
account, then use an isolated test table and two test sessions to verify transaction
and lock IDs link correctly. Do not inject locks into existing application tables.
Verify privileges, actual MySQL 8.0 patch version, elapsed query time and server
impact. The existing DB metadata stubs and Prometheus tools remain unchanged.
No bot restart, account provisioning, fault injection or Git push is part of this
implementation. Rollback consists of removing the five catalog entries; existing
tools continue to use their original adapters.
