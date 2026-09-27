/** Consumer V1 contracts from PRD 06. JSON schemas are authoritative at runtime. */
export type ArtifactReference = `ev_${string}` | `tool:tc_${string}/${string}`;

export interface DiagnosisResultV1 {
  readonly contract_version: "diagnosis-result/1.0.0";
  readonly inferred_domains: readonly {
    readonly domain: string;
    readonly reason: string;
  }[];
  readonly preliminary_findings: readonly {
    readonly finding: string;
    readonly basis: readonly ArtifactReference[];
    readonly level: "normal" | "warning" | "critical" | "unknown";
  }[];
  readonly suspected_causes: readonly {
    readonly cause: string;
    readonly basis: readonly ArtifactReference[];
    readonly confidence: "low" | "medium" | "high";
  }[];
  readonly recommended_checks: readonly string[];
  readonly incomplete_reasons: readonly string[];
}

export interface TimeRange {
  readonly start: string;
  readonly end: string;
}

interface EvidenceBase {
  readonly evidence_id: `ev_${string}`;
  readonly run_id: `run_${string}`;
  readonly tool_call_id: `tc_${string}`;
  readonly time_range: TimeRange;
  readonly assessment: "positive" | "negative" | "inconclusive";
  readonly severity: "info" | "warning" | "critical" | "unknown";
  readonly summary: string;
  readonly truncated: boolean;
  readonly redaction_status: "passed" | "redacted";
  readonly collected_at: string;
}

/** Existing Evidence 1.1.0; this does not accept the transitional YAML DTO. */
export type Evidence = EvidenceBase & (
  | {
      readonly tool_name: "backend_5xx_rate";
      readonly source: "prometheus";
      readonly source_contract_version: "backend_5xx_rate/v1";
      readonly category: "metric";
      readonly payload: {
        readonly baseline_range: TimeRange;
        readonly request_count: number | null;
        readonly error_5xx_count: number | null;
        readonly error_rate: number | null;
        readonly baseline_request_count: number | null;
        readonly baseline_error_5xx_count: number | null;
        readonly baseline_error_rate: number | null;
        readonly source_assessment: "elevated" | "not_elevated" | "insufficient_data";
        readonly reason:
          | "rate_and_delta_threshold_exceeded"
          | "below_elevation_threshold"
          | "low_sample"
          | "missing_series"
          | "malformed_series";
      };
    }
  | {
      readonly tool_name: "backend_error_log_patterns";
      readonly source: "loki";
      readonly source_contract_version: "backend_error_log_patterns/v1";
      readonly category: "log";
      readonly payload: {
        readonly patterns: readonly {
          readonly pattern: string;
          readonly count: number;
          readonly first_seen: string;
          readonly last_seen: string;
        }[];
        readonly source_assessment: "errors_observed" | "none_observed" | "insufficient_data";
      };
    }
  | {
      readonly tool_name: "backend_health";
      readonly source: "amdb_backend";
      readonly source_contract_version: "backend_health/v1";
      readonly category: "health";
      readonly payload: {
        readonly service_status: "healthy" | "degraded" | "unhealthy" | "unknown";
        readonly dependencies: readonly {
          readonly name: string;
          readonly status: "healthy" | "degraded" | "unhealthy" | "unknown";
        }[];
        readonly checked_at: string;
        readonly source_assessment: "healthy" | "degraded" | "unhealthy" | "insufficient_data";
      };
    }
);

/** Existing tool-error/1.0.0 values, not a new producer failure contract. */
export interface SanitizedToolError {
  readonly tool_call_id: `tc_${string}`;
  readonly tool_name: "unknown" | "backend_5xx_rate" | "backend_error_log_patterns" | "backend_health";
  readonly source: "tool_core" | "prometheus" | "loki" | "amdb_backend";
  readonly code:
    | "unknown_tool"
    | "invalid_input"
    | "environment_not_allowed"
    | "budget_exhausted"
    | "tool_timeout"
    | "tool_output_too_large"
    | "malformed_source_response"
    | "source_unavailable"
    | "source_permission_denied"
    | "evidence_budget_exhausted"
    | "redaction_failed"
    | "secret_exposure_risk";
  readonly retryable: false;
  readonly occurred_at: string;
}

export interface ReportAgentInputV1 {
  readonly contract_version: "report-agent-input/1.0.0";
  readonly report_schema_version: "1.1.0";
  readonly run: {
    readonly run_id: `run_${string}`;
    readonly scenario: "backend_5xx_increase";
    readonly diagnostic_reference_time: string;
  };
  readonly diagnosis: DiagnosisResultV1;
  readonly evidence_schema_version: "1.1.0";
  readonly tool_error_schema_version: "1.0.0";
  readonly evidence: readonly Evidence[];
  readonly tool_errors: readonly SanitizedToolError[];
}

export interface ReportNarrativeDraftV1 {
  readonly suspected_cause: string | null;
}

export interface ReportAgentOutputV1 {
  readonly contract_version: "report-agent-output/1.0.0";
  readonly report_schema_version: "1.1.0";
  readonly run_id: `run_${string}`;
  readonly suspected_cause: string | null;
}
