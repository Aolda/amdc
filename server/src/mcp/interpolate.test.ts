import { describe, it, expect } from "vitest";
import {
  interpolate,
  interpolateArray,
  interpolateRecord,
  maskSecrets,
} from "./interpolate.js";

describe("interpolate", () => {
  const ns = {
    input: { query: "SELECT 1", limit: 10 },
    secret: { USER: "ro", TOKEN: "tok-xyz" },
    route: { host: "db.local", port: 5432 },
    ctx: { environment: "staging", session: "s-1", agentType: "monitor" },
  };

  it("replaces a single placeholder", () => {
    expect(interpolate("${input.query}", ns)).toBe("SELECT 1");
  });

  it("replaces multiple placeholders in one string", () => {
    expect(interpolate("host=${route.host} port=${route.port}", ns)).toBe(
      "host=db.local port=5432",
    );
  });

  it("coerces numbers to string", () => {
    expect(interpolate("${input.limit}", ns)).toBe("10");
  });

  it("leaves unmatched placeholder as empty string by default", () => {
    expect(interpolate("${input.missing}", ns)).toBe("");
  });

  it("ctx namespace works", () => {
    expect(interpolate("env=${ctx.environment}", ns)).toBe("env=staging");
  });

  it("interpolateArray maps over items", () => {
    expect(
      interpolateArray(
        ["psql", "-h", "${route.host}", "-c", "${input.query}"],
        ns,
      ),
    ).toEqual(["psql", "-h", "db.local", "-c", "SELECT 1"]);
  });

  it("interpolateRecord maps over values", () => {
    expect(
      interpolateRecord({ PGTOKENWORD: "${secret.TOKEN}", TZ: "UTC" }, ns),
    ).toEqual({ PGTOKENWORD: "tok-xyz", TZ: "UTC" });
  });
});

describe("maskSecrets", () => {
  it("replaces secret values with ***", () => {
    expect(
      maskSecrets("user=ro pass=tok-xyz", { USER: "ro", TOKEN: "tok-xyz" }),
    ).toBe("user=*** pass=***");
  });

  it("leaves text alone when no matches", () => {
    expect(maskSecrets("hello world", { TOKEN: "tok-xyz" })).toBe(
      "hello world",
    );
  });

  it("ignores empty secret values (would match everything)", () => {
    expect(maskSecrets("abc", { EMPTY: "" })).toBe("abc");
  });

  it("handles regex metacharacters in secret values", () => {
    expect(maskSecrets("key=a.b+c", { K: "a.b+c" })).toBe("key=***");
  });
});
