import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase, type DB } from "../db/index.js";
import { createMarkdownStore } from "../storage/markdown.js";
import {
  createSkill,
  findAllSkills,
  findSkillById,
  updateSkill,
  deleteSkill,
} from "./repository.js";

describe("skills repository", () => {
  let db: DB;
  let dir: string;
  let store: ReturnType<typeof createMarkdownStore>;

  beforeEach(async () => {
    db = await createDatabase(":memory:");
    dir = mkdtempSync(join(tmpdir(), "amdc-skills-"));
    store = createMarkdownStore(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a skill and writes the body file", async () => {
    const skill = await createSkill(db, store, {
      name: "log-grep",
      description: "search logs",
      body: "# How to grep logs",
    });

    expect(skill.name).toBe("log-grep");
    expect(skill.body).toBe("# How to grep logs");
    const reread = await findSkillById(db, store, skill.id);
    expect(reread?.body).toBe("# How to grep logs");
  });

  it("lists all skills with body content", async () => {
    await createSkill(db, store, { name: "a", body: "body-a" });
    await createSkill(db, store, { name: "b", body: "body-b" });
    const all = await findAllSkills(db, store);
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.body).sort()).toEqual(["body-a", "body-b"]);
  });

  it("updates body and metadata", async () => {
    const skill = await createSkill(db, store, {
      name: "x",
      body: "old",
    });
    const updated = await updateSkill(db, store, skill.id, {
      name: "x2",
      body: "new",
    });
    expect(updated?.name).toBe("x2");
    expect(updated?.body).toBe("new");
  });

  it("deletes both row and file", async () => {
    const skill = await createSkill(db, store, {
      name: "to-delete",
      body: "x",
    });
    const ok = await deleteSkill(db, store, skill.id);
    expect(ok).toBe(true);
    expect(await findSkillById(db, store, skill.id)).toBeUndefined();
  });
});
