import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "./config";
export { env, projectRoot } from "./config";
export * from "./schema";
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 12,
});
export const db = drizzle(pool);
export async function query<
  T extends pg.QueryResultRow = Record<string, unknown>,
>(sql: string, values: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(sql, values)).rows;
}
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

export { and, eq } from "drizzle-orm";
