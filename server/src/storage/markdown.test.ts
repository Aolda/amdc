import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMarkdownStore } from "./markdown.js";

describe("markdown store", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "amdc-md-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes and reads a file by name", async () => {
    const store = createMarkdownStore(dir);
    await store.write("hello", "# Hello world");
    expect(await store.read("hello")).toBe("# Hello world");
  });

  it("returns empty string when file does not exist", async () => {
    const store = createMarkdownStore(dir);
    expect(await store.read("missing")).toBe("");
  });

  it("deletes a file", async () => {
    const store = createMarkdownStore(dir);
    await store.write("gone", "body");
    await store.remove("gone");
    expect(existsSync(join(dir, "gone.md"))).toBe(false);
  });

  it("remove is idempotent", async () => {
    const store = createMarkdownStore(dir);
    await expect(store.remove("never")).resolves.toBeUndefined();
  });

  it("rejects names with path traversal", async () => {
    const store = createMarkdownStore(dir);
    await expect(store.write("../etc/passwd", "x")).rejects.toThrow();
    await expect(store.write("foo/bar", "x")).rejects.toThrow();
    await expect(store.write("", "x")).rejects.toThrow();
  });

  it("creates the directory if missing", async () => {
    const nested = join(dir, "nested");
    const store = createMarkdownStore(nested);
    await store.write("a", "b");
    expect(await store.read("a")).toBe("b");
  });
});
