/**
 * `lord build <slug>` — turn a finished draft into the artifact the player loads.
 *
 * This is the only place the full validator runs. Authoring is allowed to be
 * half-finished; a published dream is not. Everything relational gets checked here —
 * doors pointing at rooms that exist, locks whose keys lie in front of them, figures
 * standing somewhere real — because after this the web player trusts the file.
 *
 * The secret is *not* copied. dream.json carries its hash and nothing else, so the
 * artifact can be served, downloaded and read by a player without giving away the one
 * line the whole dream is about (§2).
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DREAM_FORMAT_VERSION,
  validateAtlasManifest,
  validateDreamArtifact,
  type DreamArtifact,
} from "../../../src/shared/dream";
import { PUBLIC_DREAM_DIR, dreamDir, loadDraft, statusOf } from "../project";
import { color, heading, note, ok, warn } from "../term/prompt";
import type { Flags } from "../cli";

export async function buildCommand(
  slug: string | undefined,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord build <slug>");
  const draft = await loadDraft(slug);
  const status = await statusOf(draft);

  heading(`Build — ${draft.title}`);

  if (status.missing.length > 0) {
    throw new Error(
      `"${slug}" is not finished:\n    ${status.missing.map((m) => `bun run ${m}`).join("\n    ")}`,
    );
  }
  if (!draft.map || !draft.secretHash)
    throw new Error("draft is missing its map or secret");

  const dir = dreamDir(slug);

  // The atlas is validated as a file rather than from memory: `lord art` may have run
  // in another session, and a half-written atlas should fail here, not in a browser.
  const manifest = validateAtlasManifest(
    JSON.parse(await readFile(join(dir, "atlas.json"), "utf8")),
  );

  const missingRoles: string[] = [];
  for (const room of draft.map.rooms) void room;
  for (const figure of draft.figures) {
    const prefix = `figure_${figure.archetypeId}`;
    if (!Object.keys(manifest.frames).some((name) => name.startsWith(prefix))) {
      missingRoles.push(prefix);
    }
  }
  if (missingRoles.length > 0) {
    throw new Error(
      `the atlas has no frames for ${[...new Set(missingRoles)].join(", ")} — re-run \`lord art ${slug}\``,
    );
  }

  const artifact: DreamArtifact = {
    format: DREAM_FORMAT_VERSION,
    slug: draft.slug,
    title: draft.title,
    genreContract: draft.genreContract,
    styleWords: draft.styleWords,
    secretHash: draft.secretHash,
    shards: draft.shards,
    palette: draft.palette,
    style: draft.style,
    map: draft.map,
    figures: draft.figures,
    cycle: draft.cycle,
    heartbeat: draft.heartbeat,
    atlas: draft.atlas,
    authoredAt: draft.authoredAt,
  };

  // Round-trips through JSON so the validator sees exactly what the player will fetch.
  const serialised = JSON.stringify(artifact, null, 2);
  validateDreamArtifact(JSON.parse(serialised));

  if (serialised.includes(draft.secretHash) && flags.verbose) {
    note(
      "artifact carries the hash only — plaintext stays in secret.local.txt",
    );
  }

  await writeFile(join(dir, "dream.json"), `${serialised}\n`, "utf8");

  await mkdir(PUBLIC_DREAM_DIR, { recursive: true });
  await copyFile(join(dir, "dream.json"), join(PUBLIC_DREAM_DIR, "dream.json"));
  await copyFile(join(dir, "atlas.json"), join(PUBLIC_DREAM_DIR, "atlas.json"));
  await copyFile(join(dir, "atlas.png"), join(PUBLIC_DREAM_DIR, "atlas.png"));

  const sizeKb = (serialised.length / 1024).toFixed(1);
  console.log();
  ok(`dreams/${slug}/dream.json (${sizeKb} KB)`);
  ok("public/dream/ updated — the dev server will pick it up");
  note(
    `${draft.map.rooms.length} cells · ${draft.map.doors.length} doors · ` +
      `${draft.figures.length} figures · ${draft.shards.length} hooks`,
  );
  note(
    `heartbeat every ${Math.round(draft.heartbeat.intervalMs / 1000)}s, ` +
      `cycle ${Math.round(draft.cycle.durationMs / 60000)} min`,
  );

  const holders = draft.figures.filter((f) => f.holdsShardId).length;
  if (holders < draft.shards.length) {
    warn(
      `${draft.shards.length - holders} hook(s) are not held by anyone — the dream will have to place them itself`,
    );
  }

  console.log();
  note(`Play it: ${color.bold(`bun run lord play ${slug}`)}`);
}
