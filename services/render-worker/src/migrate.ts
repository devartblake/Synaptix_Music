import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Pool } from "pg";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(packageRoot, "db", "migrations");

const MIGRATIONS = ["0001_render_jobs.sql"] as const;

// Migrations use CREATE TABLE/INDEX IF NOT EXISTS, so applying them is safe
// to repeat on every process/test startup.
export async function applyMigrations(pool: Pool): Promise<void> {
  for (const fileName of MIGRATIONS) {
    const sql = await readFile(path.join(migrationsDir, fileName), "utf8");
    await pool.query(sql);
  }
}
