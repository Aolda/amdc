import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDirectory = dirname(fileURLToPath(import.meta.url));

function collectTestFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectTestFiles(path);
      }

      return entry.isFile() && entry.name.endsWith(".test.ts") ? [path] : [];
    })
    .sort();
}

const testFiles = collectTestFiles(testsDirectory);

if (testFiles.length === 0) {
  console.error("No current-code TypeScript tests were found.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...testFiles],
  { stdio: "inherit" }
);

if (result.error) {
  console.error("Failed to start the current-code test process.");
  process.exit(1);
}

process.exit(result.status ?? 1);
