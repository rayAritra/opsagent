import { pool } from "./index";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "./config";
const c = await pool.connect();
try {
  await c.query(
    "CREATE TABLE IF NOT EXISTS public.opsagent_migrations(name text PRIMARY KEY,applied_at timestamptz DEFAULT now())",
  );
  for (const file of readdirSync(resolve(projectRoot, "packages/db/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (
      (
        await c.query(
          "SELECT 1 FROM public.opsagent_migrations WHERE name=$1",
          [file],
        )
      ).rowCount
    )
      continue;
    await c.query("BEGIN");
    await c.query(
      readFileSync(
        resolve(projectRoot, "packages/db/migrations", file),
        "utf8",
      ),
    );
    await c.query("INSERT INTO public.opsagent_migrations(name) VALUES($1)", [
      file,
    ]);
    await c.query("COMMIT");
    console.log("Applied", file);
  }
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
