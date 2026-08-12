/** Separate, hand-editable room and character cards. */

import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  ChamberDefinition,
  CharacterDefinition,
  ClueDefinition,
  DreamContent,
} from "../../../src/shared/content";
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

  for (const chamber of generated.chambers) {
    await writeJsonIfMissing(join(roomDir, `${chamber.id}.json`), chamber);
  }
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
    activeChamberCount: generated.activeChamberCount,
  });

  return loadContentFiles(draft, generated);
}

export async function loadContentFiles(
  draft: DreamDraft,
  fallback = draft.content,
): Promise<DreamContent> {
  const base = contentDir(draft.slug);
  const [chambers, characters, clues] = await Promise.all([
    readJsonDirectory<ChamberDefinition>(join(base, "rooms")),
    readJsonDirectory<CharacterDefinition>(join(base, "characters")),
    readJsonDirectory<ClueDefinition>(join(base, "clues")),
  ]);
  let activeChamberCount = fallback.activeChamberCount;
  const settingsPath = join(base, "settings.json");
  if (await exists(settingsPath)) {
    const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
      activeChamberCount?: number;
    };
    if (Number.isFinite(settings.activeChamberCount)) {
      activeChamberCount = Number(settings.activeChamberCount);
    }
  }
  return {
    characters: characters.length > 0 ? characters : fallback.characters,
    chambers: chambers.length > 0 ? chambers : fallback.chambers,
    clues: clues.length > 0 ? clues : fallback.clues,
    mnemonic: fallback.mnemonic,
    activeChamberCount,
  };
}
