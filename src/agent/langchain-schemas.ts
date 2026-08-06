import { z } from "zod/v3";
import type { JsonObjectSchema, JsonSchemaProperty } from "../tools/types.js";

export const diagnosisDraftSchema = z.object({
  inferredDomains: z
    .array(
      z.object({
        domain: z.string().min(1),
        reason: z.string().min(1)
      })
    )
    .default([]),
  preliminaryFindings: z
    .array(
      z.object({
        finding: z.string().min(1),
        basis: z.array(z.string().min(1)).default([]),
        level: z.enum(["normal", "warning", "critical", "unknown"])
      })
    )
    .default([]),
  suspectedCauses: z
    .array(
      z.object({
        cause: z.string().min(1),
        reason: z.string().min(1),
        confidence: z.enum(["low", "medium", "high"])
      })
    )
    .default([]),
  recommendedChecks: z.array(z.string().min(1)).default([]),
  incompleteReasons: z.array(z.string().min(1)).default([])
});

export type DiagnosisDraft = z.infer<typeof diagnosisDraftSchema>;

export function jsonObjectSchemaToZod(schema: JsonObjectSchema): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, property] of Object.entries(properties)) {
    const converted = jsonSchemaPropertyToZod(property);
    shape[key] = required.has(key) ? converted : converted.optional();
  }

  const objectSchema = z.object(shape);
  return schema.additionalProperties === false ? objectSchema.strict() : objectSchema;
}

function jsonSchemaPropertyToZod(property: JsonSchemaProperty): z.ZodTypeAny {
  if (property.type === "number") {
    let schema = z.number();

    if (property.enum?.length) {
      return literalsToZodUnion(property.enum);
    }

    if (property.minimum !== undefined) {
      schema = schema.min(property.minimum);
    }

    if (property.maximum !== undefined) {
      schema = schema.max(property.maximum);
    }

    return property.description ? schema.describe(property.description) : schema;
  }

  if (property.type === "string") {
    let schema = z.string();

    if (property.enum?.length) {
      return literalsToZodUnion(property.enum);
    }

    if (property.minLength !== undefined) {
      schema = schema.min(property.minLength);
    }

    if (property.maxLength !== undefined) {
      schema = schema.max(property.maxLength);
    }

    return property.description ? schema.describe(property.description) : schema;
  }

  const schema = z.boolean();
  return property.description ? schema.describe(property.description) : schema;
}

function literalsToZodUnion(
  values: readonly (number | string)[]
): z.ZodTypeAny {
  const literals = values.map((value) => z.literal(value));

  if (literals.length === 1) {
    return literals[0];
  }

  return z.union(
    literals as [
      z.ZodLiteral<number | string>,
      z.ZodLiteral<number | string>,
      ...z.ZodLiteral<number | string>[]
    ]
  );
}
