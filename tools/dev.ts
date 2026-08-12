import { spawn, type ChildProcess } from "node:child_process";

const children: ChildProcess[] = [];

function launch(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): void {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.push(child);
  child.once("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
    stop();
  });
}

let stopping = false;
function stop(): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

launch("bunx", ["vite"]);
launch("bun", ["--watch", "src/server/index.ts"], {
  DREAMWALKER_DEV: "1",
  DREAMWALKER_API_PORT: "8081",
});

await Promise.all(
  children.map(
    (child) =>
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
  ),
);
