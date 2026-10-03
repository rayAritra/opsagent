import "./env";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
const databaseDir = resolve(".local/postgres");
mkdirSync(".local", { recursive: true });
const probe = new pg.Client({
  connectionString: "postgres://opsagent:opsagent@127.0.0.1:5433/postgres",
});
let alreadyRunning = false;
try {
  await probe.connect();
  alreadyRunning = true;
} catch {
  /* Database is not running yet. */
} finally {
  await probe.end().catch(() => {});
}
if (alreadyRunning) {
  console.log("Local PostgreSQL is already running on 5433");
  process.exit(0);
}
let stop: () => Promise<void>;
if (process.platform === "win32" && process.arch === "arm64") {
  const bin = resolve(".local/postgres-runtime/package/native/bin");
  function command(name: string, args: string[]) {
    const result = spawnSync(resolve(bin, name + ".exe"), args, {
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.status !== 0)
      throw Error(
        `Postgres ${name} failed (${result.status}). Run npm run setup -- --local-db to install the Windows ARM fallback.`,
      );
  }
  if (!existsSync(resolve(databaseDir, "PG_VERSION"))) {
    const pw = resolve(".local/postgres-password.tmp");
    writeFileSync(pw, "opsagent");
    try {
      command("initdb", [
        "-D",
        databaseDir,
        "-U",
        "opsagent",
        "--pwfile=" + pw,
        "--auth=scram-sha-256",
        "--encoding=UTF8",
        "--locale=C",
      ]);
    } finally {
      unlinkSync(pw);
    }
  }
  command("pg_ctl", [
    "-D",
    databaseDir,
    "-l",
    resolve(".local/postgres.log"),
    "-o",
    "-h 127.0.0.1 -p 5433",
    "-w",
    "start",
  ]);
  stop = async () => {
    command("pg_ctl", ["-D", databaseDir, "-m", "fast", "-w", "stop"]);
  };
} else {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const embedded = new EmbeddedPostgres({
    databaseDir,
    user: "opsagent",
    password: "opsagent",
    port: 5433,
    persistent: true,
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: console.error,
  });
  if (!existsSync(resolve(databaseDir, "PG_VERSION")))
    await embedded.initialise();
  await embedded.start();
  stop = () => embedded.stop();
}
const client = new pg.Client({
  connectionString: "postgres://opsagent:opsagent@127.0.0.1:5433/postgres",
});
await client.connect();
if (
  !(await client.query("SELECT 1 FROM pg_database WHERE datname='opsagent'"))
    .rowCount
)
  await client.query("CREATE DATABASE opsagent");
await client.end();
console.log("PostgreSQL 16 ready on 127.0.0.1:5433");
if (
  process.argv.includes("--background") &&
  process.platform === "win32" &&
  process.arch === "arm64"
)
  process.exit(0);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    void stop().then(() => process.exit(0));
  });
setInterval(() => {}, 60000);
