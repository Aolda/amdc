import sqlParser from "node-sql-parser";

export const OMITTED_SQL = "[SQL text omitted]";
const parser = new sqlParser.Parser();
const options = { database: "MySQL" };
const statements = new Set(["select", "insert", "replace", "update", "delete"]);
const literals = new Set(["number", "single_quote_string", "double_quote_string", "string",
  "hex_string", "full_hex_string", "bit_string", "natural_string", "bool", "boolean", "null"]);
const nodes = new Set([...statements, "column_ref", "binary_expr", "unary_expr", "expr_list",
  "values", "function", "aggr_func", "star", "origin"]);
const identifiers = new Set(["db", "table", "column", "columns", "as", "name"]);
const syntax: Record<string, ReadonlySet<string>> = {
  operator: new Set(["=", "!=", "<>", "<", ">", "<=", ">=", "<=>", "AND", "OR", "XOR", "NOT", "IN", "NOT IN", "LIKE", "NOT LIKE", "IS", "IS NOT", "BETWEEN", "NOT BETWEEN", "+", "-", "*", "/", "%", "DIV", "MOD", "REGEXP", "NOT REGEXP"]),
  join: new Set(["INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "CROSS JOIN", "LEFT OUTER JOIN", "RIGHT OUTER JOIN"]),
  prefix: new Set(["into"]), seperator: new Set(["", ",", "offset"]),
  type: new Set(["ASC", "DESC"])
};

// Deliberately narrow AST subset: unsupported syntax fails closed, never falls back to raw SQL.
// Identifiers remain visible for diagnosis; this is literal redaction, not general-purpose DLP.
export function sanitizeSql(value: unknown, truncated = false): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || truncated || !value.trim() || value.length >= 4096 ||
      Buffer.byteLength(value) > 8192 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return OMITTED_SQL;
  // Bound parser recursion before parsing, including pathological nesting in comments/strings.
  if ((value.match(/\(/g)?.length ?? 0) > 64) return OMITTED_SQL;
  try {
    const ast = parser.astify(value, options);
    if (Array.isArray(ast) || !statements.has(ast.type)) return OMITTED_SQL;
    let count = 0;
    const visit = (node: unknown, key = "", depth = 0): unknown => {
      if (++count > 4096 || depth > 64) throw new Error("unsupported_sql");
      if (node === null || typeof node === "boolean") return node;
      if (Array.isArray(node)) return node.map(item => visit(item, key, depth + 1));
      if (typeof node === "string") {
        if (identifiers.has(key) && (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(node) || node === "*")) return node;
        if (key === "type" && nodes.has(node)) return node;
        if (syntax[key]?.has(node)) return node;
        throw new Error("unsupported_sql");
      }
      if (typeof node !== "object") throw new Error("unsupported_sql");
      const record = node as Record<string, unknown>;
      if (typeof record.type === "string") {
        if (literals.has(record.type)) return { type: "origin", value: "?" };
        if (record.type === "origin" && record.value === "?") return { type: "origin", value: "?" };
        if (record.type === "star" && record.value === "*") return { type: "star", value: "*" };
        if (!nodes.has(record.type) && !syntax.type.has(record.type)) throw new Error("unsupported_sql");
      }
      return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, visit(v, k, depth + 1)]));
    };
    const cleaned = visit(ast) as typeof ast;
    const result = parser.sqlify(cleaned, options);
    // No string literals or comments should survive regeneration from our restricted AST.
    if (result.length > 8192 || /['"#]|\/\*|--/.test(result)) return OMITTED_SQL;
    return result;
  } catch {
    // Parser errors can contain source text; never log or return them.
    return OMITTED_SQL;
  }
}

export function sanitizeSqlRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    /^(currentStatement|info|digest_text)$/i.test(key)
      ? sanitizeSql(value, /^(true|1)$/i.test(String(row.statementTruncated ?? false)))
      : value]));
}
