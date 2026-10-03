import { startNpm } from "./env";
const children: ReturnType<typeof startNpm>[] = [];
for (const app of ["console", "mock-company", "worker"]) {
  const child = startNpm(["run", "dev", "--workspace", `@opsagent/${app}`]);
  children.push(child);
  child.on("exit", (code) => {
    if (code && code !== 0) console.error(`${app} exited ${code}`);
  });
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    for (const child of children) child.kill();
    process.exit(0);
  });
