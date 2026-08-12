#!/usr/bin/env bun
/**
 * `lord` — the world editor.
 *
 * The Lord is a person, not a seed (§2, §7.4). This CLI is where that person creates a
 * dream: seals the secret, curates a layout, picks the art, places the figures, and
 * bakes the whole thing into an artifact. The web player only ever reads the result.
 *
 *   bun run lord init <slug>
 *   bun run lord secret <slug>
 *   bun run lord layout <slug>
 *   bun run lord art <slug>
 *   bun run lord figures <slug>
 *   bun run lord build <slug>
 *   bun run lord play <slug>
 *   bun run lord list
 */

import { color, heading, note } from "./term/prompt";
import { listDreams, loadDraft, statusOf } from "./project";

export interface Flags {
  force?: boolean;
  yes?: boolean;
  title?: string;
  genre?: string;
  style?: string;
  palette?: string;
  heartbeat?: string;
  secret?: string;
  shards?: string;
  seed?: string;
  recipe?: string;
  figures?: string;
  reference?: string;
  colors?: string;
  [key: string]: string | boolean | undefined;
}

function parseArgs(argv: string[]): {
  command: string;
  target?: string;
  flags: Flags;
} {
  const positional: string[] = [];
  const flags: Flags = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1]!.startsWith("--")) {
      flags[body] = argv[++i]!;
    } else {
      flags[body] = true;
    }
  }

  return { command: positional[0] ?? "help", target: positional[1], flags };
}

function usage(): void {
  heading("lord — Dream Walker world editor");
  console.log(`
  ${color.bold("init")}    <slug>   create a dream: title, genre contract, style words, palette
  ${color.bold("secret")}  <slug>   write and seal the immutable line, seed the hooks
  ${color.bold("layout")}  <slug>   generate a starting map, reroll until it is right, accept
  ${color.bold("art")}     <slug>   pick one of four candidates per tile, bake the atlas
  ${color.bold("figures")} <slug>   place the figures of the dream and hand them hooks
  ${color.bold("build")}   <slug>   validate and write the artifact the player loads
  ${color.bold("play")}    <slug>   build, then start the dev server on it
  ${color.bold("status")}  <slug>   what is done and what is not
  ${color.bold("list")}             every dream in this repo

${color.grey("  Flags let any command run without prompting, e.g.")}
${color.grey("    bun run lord init first-room --title 'Первая комната' --palette ash")}
`);
}

async function statusCommand(slug: string | undefined): Promise<void> {
  const slugs = slug ? [slug] : await listDreams();
  if (slugs.length === 0) {
    note("no dreams yet — start one with `bun run lord init <slug>`");
    return;
  }

  for (const each of slugs) {
    const draft = await loadDraft(each);
    const status = await statusOf(draft);
    const mark = (done: boolean): string =>
      done ? color.green("✓") : color.grey("·");

    heading(`${draft.title}  ${color.grey(each)}`);
    console.log(
      `  ${mark(true)} init      ${color.grey(draft.styleWords.join(", "))}`,
    );
    console.log(
      `  ${mark(status.hasSecret)} secret    ${color.grey(
        draft.secretHash
          ? `${draft.secretHash.slice(0, 12)}… · ${draft.shards.length} hooks`
          : "not sealed",
      )}`,
    );
    console.log(
      `  ${mark(status.hasMap)} layout    ${color.grey(
        draft.map
          ? `${draft.map.width}x${draft.map.height} tiles · ${draft.map.rooms.length} cells · ${draft.map.doors.length} doors`
          : "not generated",
      )}`,
    );
    console.log(
      `  ${mark(status.hasArt)} art       ${color.grey(status.hasArt ? "atlas baked" : "no atlas")}`,
    );
    console.log(
      `  ${mark(status.hasFigures)} figures   ${color.grey(`${draft.figures.length} placed`)}`,
    );

    if (status.missing.length > 0) {
      console.log();
      note(`next: bun run ${status.missing[0]}`);
    }
  }
}

async function listCommand(): Promise<void> {
  const slugs = await listDreams();
  if (slugs.length === 0) {
    note("no dreams yet — start one with `bun run lord init <slug>`");
    return;
  }
  heading(`${slugs.length} dream${slugs.length === 1 ? "" : "s"}`);
  for (const slug of slugs) {
    const draft = await loadDraft(slug);
    console.log(`  ${color.bold(slug.padEnd(20))} ${draft.title}`);
  }
}

async function main(): Promise<void> {
  const { command, target, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case "init": {
      const { initCommand } = await import("./commands/init");
      return initCommand(target, flags);
    }
    case "secret": {
      const { secretCommand } = await import("./commands/secret");
      return secretCommand(target, flags);
    }
    case "layout": {
      const { layoutCommand } = await import("./commands/layout");
      return layoutCommand(target, flags);
    }
    case "art": {
      const { artCommand } = await import("./commands/art");
      return artCommand(target, flags);
    }
    case "figures": {
      const { figuresCommand } = await import("./commands/figures");
      return figuresCommand(target, flags);
    }
    case "build": {
      const { buildCommand } = await import("./commands/build");
      return buildCommand(target, flags);
    }
    case "play": {
      const { playCommand } = await import("./commands/play");
      return playCommand(target, flags);
    }
    case "status":
      return statusCommand(target);
    case "list":
      return listCommand();
    case "help":
    case "--help":
    case "-h":
      return usage();
    default:
      usage();
      throw new Error(`unknown command "${command}"`);
  }
}

main().catch((error: unknown) => {
  console.error(
    `\n${color.red("✗")} ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
