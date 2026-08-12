/**
 * `lord play <slug>` — build the dream, then serve it.
 *
 * §8: one server, one dream. The dev server is that server in miniature — it publishes
 * exactly one artifact, the one you just built, at /dream/.
 */

import { spawn } from "node:child_process";

import { REPO_ROOT } from "../project";
import { heading, note } from "../term/prompt";
import { buildCommand } from "./build";
import type { Flags } from "../cli";

export async function playCommand(
  slug: string | undefined,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord play <slug>");

  await buildCommand(slug, flags);

  heading("Starting the dev server");
  note("ctrl-c to wake up");

  const child = spawn("bun", ["run", "dev"], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: process.env,
  });

  await new Promise<void>((resolve) => {
    child.on("exit", () => resolve());
  });
}
