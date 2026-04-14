import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DB = ReturnType<typeof drizzle<typeof schema>>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createDatabase(url: string): Promise<DB> {
  const client = createClient({ url });
  const db = drizzle(client, { schema });

  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../drizzle"),
  });

  return db;
}
