import "./env";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
if (process.platform === "win32" && process.arch === "arm64") {
  const p = spawnSync(
    resolve(".local/postgres-runtime/package/native/bin/pg_ctl.exe"),
    ["-D", resolve(".local/postgres"), "-m", "fast", "-w", "stop"],
    { stdio: "inherit", windowsHide: true },
  );
  process.exitCode = p.status || 0;
} else {
  console.error(
    "Stop the foreground npm run db:local process, or run docker compose down.",
  );
  process.exitCode = 1;
}
