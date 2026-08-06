import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist/tools/catalogs", { recursive: true });
cpSync("src/tools/catalogs", "dist/tools/catalogs", { recursive: true });
