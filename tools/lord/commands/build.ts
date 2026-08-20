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

import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  DREAM_FORMAT_VERSION,
  validateAtlasManifest,
  validateDreamArtifact,
  type DreamArtifact,
} from "../../../src/shared/dream";
import { PUBLIC_DREAM_DIR, dreamDir, loadDraft, statusOf } from "../project";
import {
  loadContentFiles,
  loadRoomFiles,
  loadRoomSettings,
} from "../content/files";
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
  if (!draft.secretHash) throw new Error("draft is missing its secret");
  if (!draft.spawn || !draft.finaleRoomId) {
    throw new Error("draft is missing its spawn or finale room");
  }

  const dir = dreamDir(slug);

  // The atlas is validated as a file rather than from memory: `lord art` may have run
  // in another session, and a half-written atlas should fail here, not in a browser.
  const manifest = validateAtlasManifest(
    JSON.parse(await readFile(join(dir, "atlas.json"), "utf8")),
  );
  draft.rooms = await loadRoomFiles(slug);
  if (slug === "son") {
    const { applyStreetMap } = await import("../../../dreams/son/rooms/map");
    draft.rooms = applyStreetMap(draft.rooms);
  }
  const settings = await loadRoomSettings(slug);
  draft.spawn = settings.spawn ?? draft.spawn;
  draft.finaleRoomId = settings.finaleRoomId ?? draft.finaleRoomId;
  draft.content = await loadContentFiles(draft);

  const missingRoles: string[] = [];
  for (const figure of draft.figures) {
    const prefix = `figure_${figure.archetypeId}`;
    if (!Object.keys(manifest.frames).some((name) => name.startsWith(prefix))) {
      missingRoles.push(prefix);
    }
  }
  for (const character of draft.content.characters) {
    for (const [state, frame] of Object.entries(character.portraits)) {
      if (!(frame in manifest.frames)) {
        throw new Error(
          `character ${character.id} portrait ${state} names missing frame ${frame}`,
        );
      }
    }
  }
  for (const clue of draft.content.clues) {
    for (const frame of [clue.worldFrame, clue.detailFrame]) {
      if (!(frame in manifest.frames)) {
        throw new Error(`clue ${clue.id} names missing frame ${frame}`);
      }
    }
    for (const image of [clue.worldImage, clue.detailImage]) {
      if (!image) continue;
      if (!image.startsWith("assets/") || image.includes("..")) {
        throw new Error(`clue ${clue.id} image must be inside assets/`);
      }
      try {
        await access(
          join(dir, "content", "generated", image.slice("assets/".length)),
        );
      } catch {
        throw new Error(`clue ${clue.id} source is missing: content/${image}`);
      }
    }
  }
  for (const room of draft.rooms) {
    for (const role of [
      room.graphics.floorRole,
      room.graphics.wallRole,
      room.graphics.propRole,
    ]) {
      if (!(role in manifest.roleFrames)) {
        throw new Error(`room ${room.id} names missing atlas role ${role}`);
      }
    }
    const backdrop = room.graphics.backdropImage;
    if (backdrop) {
      if (!backdrop.startsWith("assets/") || backdrop.includes("..")) {
        throw new Error(
          `room ${room.id} backdropImage must be inside published assets/`,
        );
      }
      try {
        await access(
          join(dir, "content", "assets", backdrop.slice("assets/".length)),
        );
      } catch {
        throw new Error(
          `room ${room.id} backdrop source is missing: content/${backdrop}`,
        );
      }
    }
  }
  const artless = draft.rooms.filter(
    (room) => room.kind === "meta" && !room.graphics.backdropImage,
  );
  for (const room of artless) {
    warn(
      `${room.id} is a meta-space with no picture — run \`lord meta ${slug}\``,
    );
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
    rooms: draft.rooms,
    spawn: draft.spawn,
    finaleRoomId: draft.finaleRoomId,
    figures: draft.figures,
    content: draft.content,
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

  // Derived output only. Recreate it so obsolete RD candidates or renamed assets cannot
  // remain publicly reachable after an author changes a card.
  await rm(PUBLIC_DREAM_DIR, { recursive: true, force: true });
  await mkdir(PUBLIC_DREAM_DIR, { recursive: true });
  await copyFile(join(dir, "dream.json"), join(PUBLIC_DREAM_DIR, "dream.json"));
  await copyFile(join(dir, "atlas.json"), join(PUBLIC_DREAM_DIR, "atlas.json"));
  await copyFile(join(dir, "atlas.png"), join(PUBLIC_DREAM_DIR, "atlas.png"));
  for (const clue of draft.content.clues) {
    for (const image of [clue.worldImage, clue.detailImage]) {
      if (!image) continue;
      const relative = image.slice("assets/".length);
      const target = join(PUBLIC_DREAM_DIR, image);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(dir, "content", "generated", relative), target);
    }
  }
  // Object art lives beside backdrops under content/assets, so the wholesale copy below
  // carries it. Validate the paths here so a typo fails the build rather than the game.
  for (const room of draft.rooms) {
    for (const prop of room.props) {
      const image = prop.image;
      if (!image) continue;
      if (!image.startsWith("assets/") || image.includes("..")) {
        throw new Error(
          `${room.id}/${prop.id} image must be inside published assets/`,
        );
      }
      try {
        await access(join(dir, "content", image));
      } catch {
        throw new Error(
          `${room.id}/${prop.id} image is missing: content/${image}`,
        );
      }
    }
  }

  const authoredAssets = join(dir, "content", "assets");
  try {
    await access(authoredAssets);
    await cp(authoredAssets, join(PUBLIC_DREAM_DIR, "assets"), {
      recursive: true,
      force: true,
    });
  } catch {
    // Room PNGs are optional while the author is still using atlas roles.
  }

  const sizeKb = (serialised.length / 1024).toFixed(1);
  console.log();
  ok(`dreams/${slug}/dream.json (${sizeKb} KB)`);
  ok("public/dream/ updated — the dev server will pick it up");
  note(
    `${draft.rooms.length} rooms · ${draft.rooms.reduce((n, r) => n + r.doors.length, 0)} doors · ` +
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
