# Direct MySQL diagnostic tools

The mysql plugin includes only direct, parameterized read-only MySQL operations.
YAML owns each tool's input schema, fixed SELECT, filter predicates,
binding order, defaults, dependencies, ordering and environment-variable prefixes.
The `mysql_sql` executor in `src/tools/source-adapters/mysql-adapter.ts` contains
no tool-name dispatch or tool-specific SQL. It binds values through mysql2 prepared
statements; values never become SQL identifiers or clauses. Boolean options such
as includeIdle select a YAML-declared predicate via its `when` value.
Catalog definitions are trusted executable configuration: review their SQL and
use a least-privilege diagnostic account. SELECT syntax checks are not a SQL sandbox.

| Tool | Filters | Scope |
|---|---|---|
| mysql_list_databases | limit | All non-system databases visible to the diagnostic account |
| mysql_get_all_processlist | limit | All foreground connections except this query, including sleeping connections |
| mysql_get_active_processlist | limit | Non-sleeping foreground connections except this query |
| mysql_get_processlist_by_database | databaseName (required), includeIdle, limit | Foreground connections whose default database exactly matches the supplied database name |
| mysql_get_processlist_by_connection_id | connectionId (required) | One foreground connection identified by an observed MySQL backend connection ID |
| mysql_get_all_transactions | limit | All active InnoDB transactions, oldest first |
| mysql_get_transactions_by_connection_id | connectionId (required), limit | Active transactions owned by one observed MySQL backend connection |
| mysql_get_transaction_by_transaction_id | transactionId (required) | One active transaction identified by an observed InnoDB transaction ID |
| mysql_get_all_lock_waits | None | All InnoDB data-lock wait edges, capped at 100 with truncation flag |
| mysql_get_lock_waits_by_database | databaseName (required), limit | Lock-wait edges for objects in one database |
| mysql_get_lock_waits_by_table | databaseName and tableName (required), limit | Lock-wait edges for one exact table |
| mysql_get_lock_waits_by_connection_id | connectionId (required), limit | Lock-wait edges where one connection is waiter or blocker |

`mysqlUser` remains in returned rows but is not accepted as an input filter.
IDs are decimal strings, including returned connection and transaction IDs.
Input ID schemas enforce 1–20 decimal digits; limits use JSON Schema integer.
Each query fetches limit+1 rows; default limit 100, maximum 200. Results include
rows, returnedRows, truncated, collectedAt, appliedFilters and the effective limit.
appliedFilters records supplied filters plus any tool-defined filter defaults;
fixed scope restrictions from the table above still apply.
SQL text is capped at 4096
characters with statementTruncated. SQL text can contain application data;
existing-style secret scanning rejects known configured secrets and key/bearer
patterns, but is not general PII redaction. Do not persist raw results in traces.
LOCK_DATA is deliberately not selected.

For example, `mysql_get_all_processlist({})` reads all foreground connections;
`mysql_get_processlist_by_database({"databaseName":"sg"})` filters the connection default database.
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

Automated tests exercise fixed query bindings, exact database/table/ID scopes,
invalid inputs, limits, raw output, secret/size rejection, permission
errors, deadline cleanup including late connections, and 12 concurrent fake calls.
They do not establish live SQL compatibility or live server overhead.

Before deployment, execute all eleven through the actual runtime using a diagnostic
account, then use an isolated test table and two test sessions to verify transaction
and lock IDs link correctly. Do not inject locks into existing application tables.
Verify privileges, actual MySQL 8.0 patch version, elapsed query time and server
impact. Prometheus metrics and AMDB metadata are outside the mysql plugin and must
be provided by their own plugins. No account provisioning or Git push is part of
this implementation.
