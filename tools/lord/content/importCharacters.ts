/**
 * Reading `dream-walker-new/characters/<id>/SOUL.md` into character cards.
 *
 * A soul is written for a model, not for a schema: `characters/README.md` says it «идёт
 * в системный промпт как есть». So the file is copied whole and used verbatim, and only
 * the handful of fields the *engine* needs — a name, a voice, a desire, a tonus — are
 * lifted out of its sections.
 *
 * The soul itself is never published. `dream.json` is served at `/dream/dream.json`, and
 * a soul carries the figure's ПАЛЕВО section: exactly the list of things that give the
 * sanitar away. Shipping it would hand the player the answer key.
 */

import type {
  CharacterDefinition,
  PortraitFrames,
} from "../../../src/shared/content";
import { normaliseMinus } from "./importRooms";

export interface ParsedSoul {
  id: string;
  name: string;
  /** The whole file, for the system prompt. */
  soul: string;
  voice: string;
  desire: string;
  fear: string;
  taboo: string;
  activity: string;
  personality: string;
  tonus: { x: number; y: number };
}

/** `## ГОЛОС` … up to the next `##`. */
function section(markdown: string, label: string): string {
  // `\\Z` is not valid in a Unicode pattern; a negative lookahead is the portable end.
  const pattern = new RegExp(
    `^##\\s+${label}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`,
    "mu",
  );
  const body = markdown.match(pattern)?.[1] ?? "";
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("```"))
    .join(" ")
    .replace(/\*\*/g, "")
    .trim();
}

/**
 * The system prompt, preferring an explicit fence when the author wrote one.
 *
 * Only `kirill/SOUL.md` currently has a ```СИСТЕМНЫЙ ПРОМПТ``` block; the rest are meant
 * whole. Preferring the fence when present and falling back to the file is what
 * `characters/README.md` describes.
 */
export function systemPrompt(markdown: string): string {
  const fenced = markdown.match(/```\s*\n([\s\S]*?)```/);
  const afterHeading = markdown.match(/^##\s*СИСТЕМНЫЙ ПРОМПТ\s*$/m);
  if (afterHeading && fenced) return fenced[1]!.trim();
  return markdown.trim();
}

export function parseSoul(id: string, markdown: string): ParsedSoul {
  const title = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ?? id;
  const tonusRaw = normaliseMinus(section(markdown, "ТОНУС"));
  const tonus = tonusRaw.match(/\(\s*([+-]?\d+)\s*,\s*([+-]?\d+)\s*\)/);

  return {
    id,
    // Titles carry an italic gloss after the name on some souls; the name is the first line.
    name: title.split(/[—(]/)[0]!.trim(),
    soul: systemPrompt(markdown),
    voice: section(markdown, "ГОЛОС").slice(0, 400),
    desire: section(markdown, "ХОЧЕТ").slice(0, 300),
    fear: section(markdown, "ПАЛЕВО").slice(0, 300),
    taboo: section(markdown, "НЕЛЬЗЯ").slice(0, 300),
    activity: section(markdown, "ФИЗИКА").slice(0, 300),
    personality: section(markdown, "КТО").slice(0, 600),
    tonus: { x: Number(tonus?.[1] ?? 0), y: Number(tonus?.[2] ?? 0) },
  };
}

function portraitFrames(archetypeId: string): PortraitFrames {
  const frame = `figure_${archetypeId}_s_0`;
  return { neutral: frame, interested: frame, wary: frame, knows: frame };
}

/**
 * A parsed soul into a character card.
 *
 * `archetypeId` stays inside the four silhouettes the atlas actually has — identity
 * rides on `spriteSheet` and `portraitImages` once the art exists, and until then a
 * placeholder that draws beats a missing frame that throws.
 */
export function toCharacterCard(
  soul: ParsedSoul,
  archetypeId: string,
): CharacterDefinition {
  return {
    id: soul.id,
    name: soul.name,
    archetypeId,
    personality: soul.personality || "Фигура этого сна.",
    role: "фигура сна",
    voice: soul.voice || "говорит коротко и бытово",
    desire: soul.desire || "чтобы его оставили в покое",
    fear: soul.fear || "что собеседник не отсюда",
    taboo: soul.taboo || "не говорит о том, чего здесь знать неоткуда",
    initialActivity: soul.activity || "занят своим",
    portraits: portraitFrames(archetypeId),
    portraitImages: null,
    spriteSheet: null,
    soulPath: `souls/${soul.id}.md`,
    tonus: soul.tonus,
    // The Eye's scale is «сколько правды санитар сказал», not suspicion, and its axis is
    // switched off — so it is the one figure the generic ratchet must not apply to.
    suspicionMonotone: soul.id !== "glaz",
  };
}
