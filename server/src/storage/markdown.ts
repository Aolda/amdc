import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

export const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

function ensureValidName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Invalid name: ${name}`);
  }
}

export interface MarkdownStore {
  read(name: string): Promise<string>;
  write(name: string, body: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export function createMarkdownStore(dir: string): MarkdownStore {
  function pathFor(name: string): string {
    ensureValidName(name);
    return join(dir, `${name}.md`);
  }

  return {
    async read(name) {
      try {
        return await readFile(pathFor(name), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
        throw err;
      }
    },

    async write(name, body) {
      const target = pathFor(name);
      await mkdir(dir, { recursive: true });
      await writeFile(target, body, "utf8");
    },

    async remove(name) {
      try {
        await unlink(pathFor(name));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        throw err;
      }
    },
  };
}
