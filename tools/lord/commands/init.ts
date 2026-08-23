/**
 * `lord init <slug>` — bring a dream into existence.
 *
 * This is where the Lord fixes the things §7.1 says must be fixed once and never per
 * asset: the palette, the style words, the genre contract. Everything after this
 * command inherits them.
 */

import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

import {
  DEFAULT_PALETTE_COLORS,
  DREAM_FORMAT_VERSION,
  MAX_PALETTE_COLORS,
  type Palette,
} from "../../../src/shared/dream";
import { defaultStyle, type StyleProfile } from "../../../src/shared/art/style";
import {
  PALETTE_CHOICES,
  paletteByName,
  paletteFromReference,
} from "../art/palette";
import { readReference } from "../art/reference";
import {
  ASSETS_DIR,
  DEFAULT_CYCLE,
  DEFAULT_HEARTBEAT,
  REPO_ROOT,
  draftExists,
  isValidSlug,
  saveDraft,
  fallbackContent,
  type DreamDraft,
} from "../project";
import {
  ask,
  askRequired,
  choose,
  heading,
  note,
  ok,
  warn,
} from "../term/prompt";
import { renderSwatches } from "../term/pixels";
import type { Flags } from "../cli";

const IMAGE_EXTENSIONS = new Set([".png"]);

/**
 * The reference image, if there is an obvious one.
 *
 * A Lord who has dropped a single picture into `assets/` has already said what the dream
 * should look like, and making them then name it on the command line is ceremony. More
 * than one and the guess would be a coin toss, so ask instead.
 */
async function findReference(): Promise<string | null> {
  try {
    const entries = await readdir(ASSETS_DIR, { withFileTypes: true });
    const images = entries
      .filter((e) => e.isFile() && IMAGE_EXTENSIONS.has(extname(e.name)))
      .map((e) => join(ASSETS_DIR, e.name));
    return images.length === 1 ? images[0]! : null;
  } catch {
    return null;
  }
}

/** Set when the palette came from a picture; recorded as provenance. */
let referenceUsed: string | null = null;

/**
 * §7.1 — the palette is fixed once, for the whole dream. Either it is measured off a
 * reference the Lord drew, or it is one of the four built-ins.
 */
async function choosePalette(
  slug: string,
  flags: Flags,
): Promise<{ palette: Palette; style: StyleProfile }> {
  referenceUsed = null;

  // An explicit --palette is the Lord saying "not from a picture", so it wins outright.
  const explicitReference =
    typeof flags.reference === "string" ? flags.reference : null;
  const reference =
    explicitReference ?? (flags.palette ? null : await findReference());

  if (!reference) {
    const paletteName =
      flags.palette ??
      (await choose("Palette — fixed for the whole dream:", PALETTE_CHOICES));
    const palette = paletteByName(paletteName);
    return { palette, style: defaultStyle(palette.colors.length) };
  }

  const size = clampColors(flags.colors);
  const art = await readReference(reference, size);
  referenceUsed = relative(REPO_ROOT, reference);

  note("");
  note(`Palette taken from ${referenceUsed}`);
  note(
    `  ${art.width}x${art.height}, ${art.sourceColors} colours in the source, kept ${art.colors.length}`,
  );
  note(
    `  outline ${art.colors[art.style.outlineIndex]}, ground ${art.colors[art.style.groundIndex]}, ` +
      `accent ${art.colors[art.style.accentIndex]}`,
  );
  note(
    art.style.ditherDensity < 0.005
      ? "  the reference does not dither; generated tiles will not either"
      : `  dither density ${art.style.ditherDensity.toFixed(3)}`,
  );

  return {
    palette: paletteFromReference(slug, art.colors, art.style),
    style: art.style,
  };
}

function clampColors(flag: string | boolean | undefined): number {
  if (typeof flag !== "string") return DEFAULT_PALETTE_COLORS;
  const asked = Number(flag);
  if (!Number.isFinite(asked)) return DEFAULT_PALETTE_COLORS;
  const size = Math.round(asked);
  if (size < 4 || size > MAX_PALETTE_COLORS) {
    warn(
      `--colors ${flag} is outside 4..${MAX_PALETTE_COLORS}; using ${DEFAULT_PALETTE_COLORS}`,
    );
    return DEFAULT_PALETTE_COLORS;
  }
  return size;
}

export async function initCommand(
  slug: string | undefined,
  flags: Flags,
): Promise<void> {
  if (!slug) throw new Error("usage: lord init <slug>");
  if (!isValidSlug(slug)) {
    throw new Error(
      `"${slug}" is not a usable slug — lowercase letters, digits and dashes`,
    );
  }
  if ((await draftExists(slug)) && !flags.force) {
    throw new Error(`"${slug}" already exists. Pass --force to start it over.`);
  }

  heading(`New dream: ${slug}`);
  note(
    "One server, one dream, one secret. These answers are fixed for its whole life.",
  );

  const title = flags.title ?? (await askRequired("Title", slug));

  note("");
  note(
    "The genre contract (§6): what a miracle looks like in this world. Cyberpunk gets",
  );
  note(
    "a cortical siphon, a folk tale gets a witch who talks to the dead. Without it,",
  );
  note("anything the dream improvises later shows its seams.");
  const genreContract =
    flags.genre ??
    (await askRequired(
      "Genre contract",
      "A late-Soviet hospital where the walls remember what happened in them",
    ));

  note("");
  note(
    "Three to five words of art direction (§7.1). Every tile will be made under them.",
  );
  const styleWordsRaw =
    flags.style ??
    (await ask("Style words", "cold, institutional, worn, quiet"));
  const styleWords = styleWordsRaw
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
  if (styleWords.length === 0) styleWords.push("cold", "quiet");
  if (styleWords.length > 5) {
    warn(
      `${styleWords.length} style words is more direction than a model can hold; keeping five`,
    );
    styleWords.length = 5;
  }

  const { palette, style } = await choosePalette(slug, flags);
  console.log();
  console.log(renderSwatches(palette.colors));

  const langFlag = flags.lang ?? flags.language;
  const languageRaw =
    typeof langFlag === "string" ? langFlag.toLowerCase() : undefined;
  const language =
    languageRaw === "en" || languageRaw === "ru" ? languageRaw : undefined;

  const draft: DreamDraft = {
    format: DREAM_FORMAT_VERSION,
    slug,
    ...(language ? { language } : {}),
    title,
    genreContract,
    styleWords,
    secretHash: null,
    shards: [],
    palette,
    style,
    rooms: [],
    spawn: null,
    finaleRoomId: null,
    figures: [],
    content: fallbackContent({ figures: [], secretHash: null }),
    cycle: { ...DEFAULT_CYCLE },
    heartbeat: {
      ...DEFAULT_HEARTBEAT,
      intervalMs: flags.heartbeat
        ? Number(flags.heartbeat)
        : DEFAULT_HEARTBEAT.intervalMs,
    },
    atlas: "atlas.json",
    authoredAt: new Date().toISOString(),
    provenance: {
      layoutSeed: null,
      recipe: "default",
      artSeed: null,
      chosen: {},
      reference: referenceUsed,
    },
  };

  await saveDraft(draft);

  console.log();
  ok(`dreams/${slug}/draft.json written`);
  note(
    `heartbeat every ${Math.round(draft.heartbeat.intervalMs / 1000)}s, cycle ${Math.round(draft.cycle.durationMs / 60000)} min`,
  );
  console.log();
  note(`Next: bun run lord secret ${slug}`);
}
