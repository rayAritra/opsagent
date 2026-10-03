import { command, root } from "./env";
import { spawnSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
if (!existsSync(".env"))
  writeFileSync(
    ".env",
    readFileSync(".env.example", "utf8")
      .replace(
        "CREDENTIAL_ENCRYPTION_KEY=",
        "CREDENTIAL_ENCRYPTION_KEY=" + randomBytes(32).toString("hex"),
      )
      .replace(
        "SESSION_SECRET=",
        "SESSION_SECRET=" + randomBytes(32).toString("hex"),
      ),
  );
command(["install"]);
command(["run", "browser:install"]);
const local = process.argv.includes("--local-db");
if (local) {
  if (
    process.platform === "win32" &&
    process.arch === "arm64" &&
    !existsSync(".local/postgres-runtime/package/native/bin/initdb.exe")
  ) {
    mkdirSync(".local/postgres-runtime", { recursive: true });
    command([
      "pack",
      "@embedded-postgres/windows-x64@16.14.0-beta.17",
      "--pack-destination",
      ".local",
      "--loglevel=error",
    ]);
    const result = spawnSync(
      "tar",
      [
        "-xf",
        ".local/embedded-postgres-windows-x64-16.14.0-beta.17.tgz",
        "-C",
        ".local/postgres-runtime",
      ],
      { stdio: "inherit", windowsHide: true },
    );
    if (result.status !== 0)
      throw Error("Unable to extract PostgreSQL binary archive");
  }
  const child = spawn(
    process.execPath,
    ["--import", "tsx", resolve(root, "scripts/postgres.ts"), "--background"],
    { stdio: "inherit", windowsHide: true, env: process.env },
  );
  child.unref();
} else {
  const result = spawnSync("docker", ["compose", "up", "-d", "--wait"], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw Error(
      "Docker unavailable. Install Docker or use npm run setup -- --local-db.",
    );
}
const connection =
  process.env.DATABASE_URL ||
  "postgres://opsagent:opsagent@127.0.0.1:5433/opsagent";
let ready = false;
for (let i = 0; i < 60; i++) {
  const client = new pg.Client({ connectionString: connection });
  try {
    await client.connect();
    await client.end();
    ready = true;
    break;
  } catch {
    await client.end().catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!ready) throw Error("Database did not become ready in 60 seconds");
command(["run", "db:migrate"]);
command(["run", "seed"]);
console.log("Setup complete. Database remains available. Run npm run dev.");
