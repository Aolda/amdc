export type SafeErrorCategory =
  | "timeout"
  | "authentication"
  | "rate_limit"
  | "network"
  | "structured_output"
  | "aborted"
  | "provider_response"
  | "unknown";

export interface SafeErrorCauseMetadata {
  readonly name: string;
  readonly constructorName: string;
  readonly status?: number;
  readonly code?: string;
  readonly type?: string;
  readonly requestId?: string;
  readonly responseHeaders?: Readonly<Partial<Record<SafeResponseHeaderName, string>>>;
}

export type SafeResponseHeaderName =
  | "cf-ray"
  | "content-type"
  | "openai-request-id"
  | "request-id"
  | "server"
  | "traceparent"
  | "via"
  | "x-amzn-requestid"
  | "x-envoy-upstream-service-time"
  | "x-litellm-call-id"
  | "x-openai-request-id"
  | "x-request-id";

export interface SafeValidationIssueMetadata {
  readonly code: string;
  readonly path: readonly (string | number)[];
}

export interface SafeErrorMetadata extends SafeErrorCauseMetadata {
  readonly category: SafeErrorCategory;
  readonly causes: readonly SafeErrorCauseMetadata[];
  readonly validationIssues: readonly SafeValidationIssueMetadata[];
}

const MAX_CAUSE_DEPTH = 3;
const MAX_VALIDATION_ISSUES = 8;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_HEADER_VALUE_LENGTH = 200;
const SAFE_RESPONSE_HEADERS: readonly SafeResponseHeaderName[] = [
  "cf-ray",
  "content-type",
  "openai-request-id",
  "request-id",
  "server",
  "traceparent",
  "via",
  "x-amzn-requestid",
  "x-envoy-upstream-service-time",
  "x-litellm-call-id",
  "x-openai-request-id",
  "x-request-id"
];

export function toSafeErrorMetadata(error: unknown): SafeErrorMetadata {
  const root = readErrorNode(error);
  const causes: SafeErrorCauseMetadata[] = [];
  const visited = new Set<unknown>([error]);
  let current = readCause(error);

  while (current !== undefined && causes.length < MAX_CAUSE_DEPTH) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    causes.push(readErrorNode(current));
    current = readCause(current);
  }

  return {
    ...root,
    category: classifyError(error),
    causes,
    validationIssues: readValidationIssues(error)
  };
}

function readErrorNode(error: unknown): SafeErrorCauseMetadata {
  const record = isRecord(error) ? error : {};
  const name =
    error instanceof Error
      ? error.name
      : readSafeIdentifier(record.name) ?? "UnknownError";
  const constructorName =
    isRecord(error) && error.constructor && typeof error.constructor.name === "string"
      ? toSafeIdentifier(error.constructor.name, "Unknown")
      : "Unknown";

  return {
    name: toSafeIdentifier(name, "UnknownError"),
    constructorName,
    ...readStatus(record),
    ...optionalField("code", readSafeIdentifier(record.code)),
    ...optionalField("type", readSafeIdentifier(record.type)),
    ...optionalField("requestId", readRequestId(record)),
    ...optionalResponseHeaders(readResponseHeaders(record.headers))
  };
}

function readStatus(record: Record<string, unknown>): { readonly status?: number } {
  const candidate =
    typeof record.status === "number" ? record.status : record.statusCode;
  return typeof candidate === "number" && Number.isInteger(candidate)
    ? { status: candidate }
    : {};
}

function readCause(error: unknown): unknown {
  return isRecord(error) ? error.cause : undefined;
}

function readValidationIssues(error: unknown): readonly SafeValidationIssueMetadata[] {
  const record = isRecord(error) ? error : {};
  if (!Array.isArray(record.issues)) {
    return [];
  }

  return record.issues.slice(0, MAX_VALIDATION_ISSUES).flatMap((issue) => {
    if (!isRecord(issue)) {
      return [];
    }

    const code = readSafeIdentifier(issue.code);
    if (!code) {
      return [];
    }

    const path = Array.isArray(issue.path)
      ? issue.path.filter(
          (segment): segment is string | number =>
            (typeof segment === "string" && SAFE_IDENTIFIER.test(segment)) ||
            (typeof segment === "number" && Number.isInteger(segment))
        )
      : [];

    return [{ code, path }];
  });
}

function classifyError(error: unknown): SafeErrorCategory {
  const values: string[] = [];
  const statuses: number[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current !== undefined; depth += 1) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);

    const record = isRecord(current) ? current : {};
    const status = readStatus(record).status;
    if (status !== undefined) {
      statuses.push(status);
    }
    values.push(
      current instanceof Error ? current.name : String(record.name ?? ""),
      typeof record.code === "string" ? record.code : "",
      typeof record.type === "string" ? record.type : "",
      current instanceof Error
        ? current.message
        : typeof record.message === "string"
          ? record.message
          : ""
    );
    current = record.cause;
  }

  const text = values.join(" ").toLowerCase();

  if (/timeout|timed out|etimedout/.test(text)) return "timeout";
  if (/abort|aborted/.test(text)) return "aborted";
  if (
    statuses.some((status) => status === 401 || status === 403) ||
    /auth|api[_ -]?key|permission/.test(text)
  ) {
    return "authentication";
  }
  if (statuses.includes(429) || /rate[_ -]?limit|too many requests/.test(text)) {
    return "rate_limit";
  }
  if (/zod|schema|structured|validation|tool[_ -]?call|invalid response/.test(text)) {
    return "structured_output";
  }
  if (/econn|enotfound|socket|network|fetch failed|connection/.test(text)) {
    return "network";
  }
  if (statuses.length > 0 || /provider|openai|response/.test(text)) {
    return "provider_response";
  }
  return "unknown";
}

function readSafeIdentifier(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : undefined;
}

function readRequestId(record: Record<string, unknown>): string | undefined {
  for (const key of ["request_id", "requestId", "_request_id"] as const) {
    const value = readSafeIdentifier(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readResponseHeaders(
  value: unknown
): Readonly<Partial<Record<SafeResponseHeaderName, string>>> | undefined {
  const entries: Array<[string, unknown]> = [];

  if (typeof Headers !== "undefined" && value instanceof Headers) {
    for (const name of SAFE_RESPONSE_HEADERS) {
      entries.push([name, value.get(name)]);
    }
  } else if (isRecord(value)) {
    for (const [name, headerValue] of Object.entries(value)) {
      entries.push([name.toLowerCase(), headerValue]);
    }
  } else {
    return undefined;
  }

  const allowed = new Set<string>(SAFE_RESPONSE_HEADERS);
  const result: Partial<Record<SafeResponseHeaderName, string>> = {};

  for (const [name, rawValue] of entries) {
    if (!allowed.has(name)) {
      continue;
    }
    const normalized = normalizeHeaderValue(rawValue);
    if (normalized) {
      result[name as SafeResponseHeaderName] = normalized;
    }
  }

  return Object.keys(result).length > 0
    ? result
    : undefined;
}

function normalizeHeaderValue(value: unknown): string | undefined {
  const text = Array.isArray(value)
    ? value.every((entry) => typeof entry === "string")
      ? value.join(", ")
      : undefined
    : typeof value === "string"
      ? value
      : undefined;

  if (
    !text ||
    text.length > MAX_HEADER_VALUE_LENGTH ||
    /[\r\n\u0000-\u001f\u007f]/.test(text) ||
    /bearer|authorization|cookie|api[_ -]?key|token/i.test(text)
  ) {
    return undefined;
  }

  return text;
}

function toSafeIdentifier(value: string, fallback: string): string {
  return SAFE_IDENTIFIER.test(value) ? value : fallback;
}

function optionalField<Key extends "code" | "type" | "requestId">(
  key: Key,
  value: string | undefined
): Partial<Record<Key, string>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, string>>;
}

function optionalResponseHeaders(
  value: Readonly<Partial<Record<SafeResponseHeaderName, string>>> | undefined
): { readonly responseHeaders?: Readonly<Partial<Record<SafeResponseHeaderName, string>>> } {
  return value === undefined ? {} : { responseHeaders: value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
