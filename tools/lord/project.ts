/**
 * Where a dream lives on disk, and how the Lord's commands hand work to each other.
 *
 * Authoring is incremental — a title today, a layout tomorrow, art when there is money
 * for it — so the in-progress state is a *draft* with holes in it. Only `lord build`
 * turns a complete draft into the artifact the player loads, and only then does the
 * full validator run.
 *
 *   dreams/<slug>/draft.json        authoring state, committed, safe to hand-edit
 *   dreams/<slug>/secret.local.txt  the sealed line in plaintext — gitignored, never served
 *   dreams/<slug>/dream.json        build output
 *   dreams/<slug>/atlas.png|json    build output
 *   public/dream/                   a copy of the build output, for the dev server
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DREAM_FORMAT_VERSION,
  type CycleConfig,
  type FigurePlacement,
  type HeartbeatConfig,
  type Palette,
  type Shard,
  type DreamTranslation,
} from "../../src/shared/dream";
import type { SupportedLocale } from "../../src/shared/i18n";
import type { DreamRoom, DreamSpawn } from "../../src/shared/room";
import {
  fallbackPortraits,
  type CharacterDefinition,
  type DreamContent,
} from "../../src/shared/content";
import { defaultStyle, type StyleProfile } from "../../src/shared/art/style";

export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const DREAMS_DIR = join(REPO_ROOT, "dreams");
export const PUBLIC_DREAM_DIR = join(REPO_ROOT, "public", "dream");
/** Where the Lord keeps the picture a dream's look is measured from (§7.1). */
export const ASSETS_DIR = join(REPO_ROOT, "assets");
/** Mission text. Prefer the current diary; fall back to the old folder name. */
export const BIBLE_DIR = existsSync(join(REPO_ROOT, "dream-walker-anton"))
  ? join(REPO_ROOT, "dream-walker-anton")
  : join(REPO_ROOT, "dream-walker-new");

/**
 * Provenance for the generators. None of this is read at runtime — it exists so a
 * reroll is repeatable and so the record of what a human chose survives (§7.4).
 */
export interface Provenance {
  layoutSeed: string | null;
  recipe: string;
  artSeed: string | null;
  /** Tile role -> which of the four candidates the Lord picked. */
  chosen: Record<string, number>;
  /** The image the palette and style were taken from, if any. */
  reference: string | null;
}

export interface DreamDraft {
  format: number;
  slug: string;
  language?: SupportedLocale;
  title: string;
  genreContract: string;
  styleWords: string[];
  /** Null until `lord secret` has been run. */
  secretHash: string | null;
  shards: Shard[];
  palette: Palette;
  /** §7.1 measured off the reference image, or a flat default. */
  style: StyleProfile;
  /**
   * Every authored room. Empty until `lord rooms` has scaffolded them.
   *
   * Rooms are hand-drawn, not generated, so they live in `content/rooms/*.json` and are
   * loaded back into the draft on every command. Nothing re-derives them from a seed.
   */
  rooms: DreamRoom[];
  /** Null until at least one room exists. */
  spawn: DreamSpawn | null;
  /** The room the Eye is in. Null until chosen. */
  finaleRoomId: string | null;
  figures: FigurePlacement[];
  content: DreamContent;
  cycle: CycleConfig;
  heartbeat: HeartbeatConfig;
  atlas: string;
  authoredAt: string;
  provenance: Provenance;
  translations?: Partial<Record<SupportedLocale, DreamTranslation>>;
}

export const DEFAULT_CYCLE: CycleConfig = {
  durationMs: 8 * 60 * 1000,
  // `endings.md` sets four cycles before «Не сложилось». Null while a dream is unfinished.
  maxCycles: null,
};

export const DEFAULT_HEARTBEAT: HeartbeatConfig = {
  callBudgetPerCycle: 12,
  maxPatchesPerBeat: 2,
};

export function dreamDir(slug: string): string {
  return join(DREAMS_DIR, slug);
}

export function draftPath(slug: string): string {
  return join(dreamDir(slug), "draft.json");
}

export function secretPath(slug: string): string {
  return join(dreamDir(slug), "secret.local.txt");
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,48}$/.test(slug);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function draftExists(slug: string): Promise<boolean> {
  return exists(draftPath(slug));
}

export async function listDreams(): Promise<string[]> {
  try {
    const entries = await readdir(DREAMS_DIR, { withFileTypes: true });
    const slugs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory() && (await draftExists(entry.name)))
        slugs.push(entry.name);
    }
    return slugs.sort();
  } catch {
    return [];
  }
}

export async function loadDraft(slug: string): Promise<DreamDraft> {
  const path = draftPath(slug);
  if (!(await exists(path))) {
    throw new Error(
      `no dream called "${slug}". Create one with \`bun run lord init ${slug}\`.`,
    );
  }
  const draft = JSON.parse(await readFile(path, "utf8")) as DreamDraft;
  if (draft.format > DREAM_FORMAT_VERSION) {
    throw new Error(
      `draft for "${slug}" is format ${draft.format}, this build writes ${DREAM_FORMAT_VERSION}`,
    );
  }
  return migrate(draft);
}

/**
 * Bring an older draft up to the current format.
 *
 * Drafts are the Lord's hand-edited working state and can represent hours of curation, so
 * an added field must not cost them a re-authoring. The *artifact* is the versioned thing
 * and is rebuilt every time anyway; the draft only has to be readable.
 */
function migrate(draft: DreamDraft): DreamDraft {
  if (!draft.style) draft.style = defaultStyle(draft.palette.colors.length);
  draft.provenance.reference ??= null;
  draft.rooms ??= [];
  draft.spawn ??= null;
  draft.finaleRoomId ??= null;
  draft.cycle.maxCycles ??= null;
  draft.content ??= fallbackContent(draft);
  draft.format = DREAM_FORMAT_VERSION;
  return draft;
}

const PLACEHOLDER_SLOTS: Array<string | null> = [
  "abandon",
  null,
  "abandon",
  null,
  "abandon",
  null,
  "abandon",
  null,
  "abandon",
  null,
  "abandon",
  null,
];

function characterFromPlacement(figure: FigurePlacement): CharacterDefinition {
  return {
    id: figure.id,
    name: figure.name,
    archetypeId: figure.archetypeId,
    personality:
      "Держится за привычный порядок и замечает слишком ясные вопросы.",
    role: "часть больничного сна",
    voice: "говорит коротко и бытово",
    desire: "чтобы смена закончилась без происшествий",
    fear: "понять, что рядом находится чужой",
    taboo: "не обсуждает то, что лежит за пределами сна",
    initialActivity: "занят привычным делом",
    portraits: fallbackPortraits(figure.archetypeId),
  };
}

/** A usable migration/default; `lord content` writes the same records as separate files. */
export function fallbackContent(
  draft: Pick<DreamDraft, "figures" | "secretHash">,
): DreamContent {
  return {
    characters: draft.figures.map(characterFromPlacement),
    clues: Array.from({ length: 6 }, (_, index) => ({
      id: `clue-${index + 1}`,
      sensorySeed:
        "Предмет узнаваем по форме, но его нельзя называть существительным в ответе.",
      placementTags: ["clue-compatible"],
      worldFrame: "prop",
      detailFrame: "prop",
      worldImage: null,
      detailImage: null,
      marker: "бирюзовый шов с одной песочной точкой",
    })),
    mnemonic: {
      hash: draft.secretHash ?? "0".repeat(64),
      wordlist: "english",
      knownSlots: PLACEHOLDER_SLOTS,
    },
  };
}

export async function saveDraft(draft: DreamDraft): Promise<void> {
  await mkdir(dreamDir(draft.slug), { recursive: true });
  await writeFile(
    draftPath(draft.slug),
    `${JSON.stringify(draft, null, 2)}\n`,
    "utf8",
  );
}

export async function saveSecret(
  slug: string,
  plaintext: string,
): Promise<void> {
  await mkdir(dreamDir(slug), { recursive: true });
  await writeFile(
    secretPath(slug),
    `${plaintext}\n\n# This is the one line the whole dream is about (§2 of the concept).\n` +
      `# It is gitignored and never copied into the artifact — dream.json carries only its hash.\n` +
      `# Everything above the blank line is the secret; this comment is not part of it.\n`,
    "utf8",
  );
}

export async function loadSecret(slug: string): Promise<string | null> {
  const path = secretPath(slug);
  if (!(await exists(path))) return null;
  const raw = await readFile(path, "utf8");
  return raw.split("\n\n")[0]!.trim();
}

/** SHA-256, hex. The artifact carries this and never the plaintext. */
export async function sealSecret(plaintext: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(plaintext.trim()),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** What is done and what is not, for the CLI to report and for `build` to gate on. */
export interface DraftStatus {
  hasSecret: boolean;
  hasRooms: boolean;
  hasArt: boolean;
  hasFigures: boolean;
  hasContent: boolean;
  hasMnemonic: boolean;
  missing: string[];
}

export async function statusOf(draft: DreamDraft): Promise<DraftStatus> {
  const hasSecret = Boolean(draft.secretHash);
  const hasRooms = draft.rooms.length > 0 && draft.spawn !== null;
  const hasArt = await exists(join(dreamDir(draft.slug), "atlas.json"));
  const hasFigures = draft.figures.length > 0;
  const hasContent =
    draft.content.characters.length === draft.figures.length &&
    draft.figures.length > 0 &&
    draft.content.clues.length === 6;
  const hasMnemonic =
    draft.content.mnemonic.hash !== "0".repeat(64) &&
    draft.content.mnemonic.knownSlots.length === 12 &&
    draft.content.mnemonic.knownSlots.filter((slot) => slot === null).length ===
      6;

  const missing: string[] = [];
  if (!hasSecret) missing.push(`lord secret ${draft.slug}`);
  if (!hasRooms) missing.push(`lord rooms ${draft.slug}`);
  if (!hasArt) missing.push(`lord art ${draft.slug}`);
  if (!hasFigures) missing.push(`lord figures ${draft.slug}`);
  if (!hasContent) missing.push(`lord content ${draft.slug}`);
  if (!hasMnemonic) missing.push(`lord mnemonic ${draft.slug}`);

  return {
    hasSecret,
    hasRooms,
    hasArt,
    hasFigures,
    hasContent,
    hasMnemonic,
    missing,
  };
}
