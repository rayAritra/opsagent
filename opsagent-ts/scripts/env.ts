import { config } from "dotenv";
import { resolve, dirname } from "node:path";
import { spawnSync, spawn, type SpawnOptions } from "node:child_process";
export const root = process.cwd();
config({ path: resolve(root, ".env"), quiet: true });
process.env.PLAYWRIGHT_BROWSERS_PATH = resolve(
  root,
  process.env.PLAYWRIGHT_BROWSERS_PATH || ".local/browsers",
);
const npmCli =
  process.env.npm_execpath ||
  resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
export function command(args: string[]) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
  });
  if (result.status !== 0) throw Error("npm " + args.join(" ") + " failed.");
}
export function startNpm(args: string[], options: SpawnOptions = {}) {
  return spawn(process.execPath, [npmCli, ...args], {
    stdio: "inherit",
    windowsHide: true,
    env: process.env,
    ...options,
  });
}
