/** Separate, hand-editable room and character cards. */

import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  CharacterDefinition,
  ClueDefinition,
  DreamContent,
} from "../../../src/shared/content";
import type { DreamRoom, DreamSpawn } from "../../../src/shared/room";
import { dreamDir, fallbackContent, type DreamDraft } from "../project";

function contentDir(slug: string): string {
  return join(dreamDir(slug), "content");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonIfMissing(path: string, value: unknown): Promise<void> {
  if (await exists(path)) return;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonDirectory<T>(path: string): Promise<T[]> {
  if (!(await exists(path))) return [];
  const names = (await readdir(path))
    .filter((name) => name.endsWith(".json"))
    .sort();
  return Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(join(path, name), "utf8")),
    ),
  ) as Promise<T[]>;
}

export async function scaffoldContent(
  draft: DreamDraft,
): Promise<DreamContent> {
  const generated = fallbackContent(draft);
  const base = contentDir(draft.slug);
  const roomDir = join(base, "rooms");
  const characterDir = join(base, "characters");
  const clueDir = join(base, "clues");
  await Promise.all([
    mkdir(roomDir, { recursive: true }),
    mkdir(characterDir, { recursive: true }),
    mkdir(clueDir, { recursive: true }),
  ]);

  for (const character of generated.characters) {
    await writeJsonIfMissing(
      join(characterDir, `${character.id}.json`),
      character,
    );
  }
  for (const clue of generated.clues) {
    await writeJsonIfMissing(join(clueDir, `${clue.id}.json`), clue);
  }
  await writeJsonIfMissing(join(base, "settings.json"), {
    spawn: draft.spawn,
    finaleRoomId: draft.finaleRoomId,
  });

  return loadContentFiles(draft, generated);
}

export async function loadContentFiles(
  draft: DreamDraft,
  fallback = draft.content,
): Promise<DreamContent> {
  const base = contentDir(draft.slug);
  const [characters, clues] = await Promise.all([
    readJsonDirectory<CharacterDefinition>(join(base, "characters")),
    readJsonDirectory<ClueDefinition>(join(base, "clues")),
  ]);
  return {
    characters: characters.length > 0 ? characters : fallback.characters,
    clues: clues.length > 0 ? clues : fallback.clues,
    mnemonic: fallback.mnemonic,
  };
}

/**
 * The authored rooms, in filename order.
 *
 * Rooms are hand-drawn ASCII plus placements, so they are the one part of a dream that is
 * never regenerated. Name the files in the order the bible lists them (`01-otel.json`,
 * `02-shkola.json`, …) and the catalogue reads the way the atlas does.
 */
export async function loadRoomFiles(slug: string): Promise<DreamRoom[]> {
  return readJsonDirectory<DreamRoom>(join(contentDir(slug), "rooms"));
}

/** Spawn and finale, which are about the dream rather than about any one room. */
export async function loadRoomSettings(
  slug: string,
): Promise<{ spawn: DreamSpawn | null; finaleRoomId: string | null }> {
  const settingsPath = join(contentDir(slug), "settings.json");
  if (!(await exists(settingsPath))) return { spawn: null, finaleRoomId: null };
  const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
    spawn?: DreamSpawn | null;
    finaleRoomId?: string | null;
  };
  return {
    spawn: settings.spawn ?? null,
    finaleRoomId: settings.finaleRoomId ?? null,
  };
}
