/**
 * `dream-walker-new/prompts-pixelart.md` is the art contract.
 *
 * Style words, the seam rule, the deadpan tone, and every per-room / per-figure
 * subject live there. The Lord commands compose from this file rather than
 * inventing a second set of prompts that will drift.
 *
 * Must stay free of Retro Diffusion I/O — it only reads markdown.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../project";

export const PIXEL_PROMPTS_PATH = join(
  REPO_ROOT,
  "dream-walker-new",
  "prompts-pixelart.md",
);

export interface PixelPromptBook {
  style: string;
  seam: string;
  tone: string;
  negative: string;
  states: readonly [string, string, string, string];
  rooms: Map<string, RoomPrompt>;
  figures: Map<string, FigurePrompt>;
}

export interface RoomPrompt {
  heading: string;
  body: string;
  seam: boolean;
  tone: boolean;
  meta: boolean;
}

export interface FigurePrompt {
  heading: string;
  body: string;
  seam: boolean;
  tone: boolean;
}

const FIGURE_IDS: Record<string, string> = {
  кирилл: "kirill",
  папа: "papa",
  мама: "mama",
  "бабушка надя": "babushka-nadya",
  "лёша гнедков": "liosha-gnedkov",
  нилюфар: "nilufar",
  турышев: "turyshev",
  антон: "anton",
  "глаз, смотрящий вниз": "glaz",
  убийца: "ubiitsa",
  должники: "dolzhniki",
  "крипто-бро": "kripto-bro",
  художник: "hudozhnik",
  тётя: "tetya",
};

function fenceAfter(source: string, heading: string): string {
  const at = source.indexOf(heading);
  if (at < 0) throw new Error(`prompts-pixelart.md missing ${heading}`);
  const fence = source.slice(at).match(/```\n([\s\S]*?)\n```/);
  if (!fence) throw new Error(`prompts-pixelart.md: no fence after ${heading}`);
  return collapse(fence[1]!);
}

function collapse(text: string): string {
  return text
    .replace(/\[СТИЛЬ 1\.\d\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tagged(text: string, tag: string): boolean {
  return text.includes(tag);
}

/** Stable id from a `**01. Title**` or `**М1. Title**` heading. */
export function roomKeyFromHeading(heading: string): string {
  const meta = heading.match(/^М(\d)/u);
  if (meta) return `m${meta[1]}`;
  const place = heading.match(/^(\d{2})/);
  if (place) return place[1]!;
  return heading.toLowerCase();
}

export function parsePixelPrompts(markdown: string): PixelPromptBook {
  const style = fenceAfter(markdown, "### 1.1.");
  const seam = fenceAfter(markdown, "### 1.2.");
  const tone = fenceAfter(markdown, "### 1.3.");
  const negative = fenceAfter(markdown, "### 1.4.");

  const stateBlock = fenceAfter(markdown, "### 2.2.");
  const stateLines = [...stateBlock.matchAll(/S(\d)\s+(.+?)(?=\s+S\d\s+|$)/g)];
  const states = ["", "", "", ""] as [string, string, string, string];
  for (const match of stateLines) {
    const index = Number(match[1]);
    if (index >= 0 && index <= 3) states[index] = match[2]!.trim();
  }

  const rooms = new Map<string, RoomPrompt>();
  const roomPattern = /\*\*((?:\d{2}|М\d)\.\s+[^*]+)\*\*\s*```\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(roomPattern)) {
    const heading = match[1]!.trim();
    const raw = match[2]!;
    rooms.set(roomKeyFromHeading(heading), {
      heading,
      body: collapse(raw),
      seam: tagged(raw, "1.2"),
      tone: tagged(raw, "1.3"),
      meta: heading.startsWith("М"),
    });
  }

  const figures = new Map<string, FigurePrompt>();
  const figurePattern = /\*\*([^*]+)\*\* —[^\n]*\n```\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(figurePattern)) {
    const heading = match[1]!.trim();
    const id = FIGURE_IDS[heading.toLowerCase()];
    if (!id) continue;
    const raw = match[2]!;
    figures.set(id, {
      heading,
      body: collapse(raw),
      seam: tagged(raw, "1.2"),
      tone: tagged(raw, "1.3"),
    });
  }

  return { style, seam, tone, negative, states, rooms, figures };
}

let cached: PixelPromptBook | null = null;

export function pixelPrompts(): PixelPromptBook {
  cached ??= parsePixelPrompts(readFileSync(PIXEL_PROMPTS_PATH, "utf8"));
  return cached;
}

function joinParts(parts: Array<string | false | null | undefined>): string {
  return parts
    .filter((part): part is string => !!part && part.length > 0)
    .join(", ");
}

/**
 * A room's picture. Places omit the seam rule (§3.1) unless the card asks for it;
 * meta-spaces keep it. The camera line stays last so expansion cannot bury it.
 */
export function roomBackdropPrompt(roomId: string): string {
  const book = pixelPrompts();
  const key = roomId.startsWith("m") ? roomId.slice(0, 2) : roomId.slice(0, 2);
  const room = book.rooms.get(key);
  if (!room) {
    throw new Error(`prompts-pixelart.md has no room card for ${roomId}`);
  }
  const camera = room.meta
    ? "one full-frame picture, no tile grid, cream void or shaft filling the frame"
    : "top-down overhead view looking straight down, floor plan seen from above, orthographic bird's eye, no horizon, no perspective";
  return joinParts([
    book.style,
    (room.meta || room.seam) && book.seam,
    room.tone && book.tone,
    room.body,
    camera,
  ]);
}

/** Wordless clue object: the master style plus the noun, never the letters. */
export function clueObjectPrompt(word: string): string {
  const book = pixelPrompts();
  return joinParts([
    book.style,
    book.seam,
    book.tone,
    `one clearly recognizable ${word}, isolated full silhouette, ordinary proportions, blank unmarked surfaces`,
    "a single turquoise seam with one sand-colored dot",
    "off-center asymmetric framing",
  ]);
}

export function objectHotspotPrompt(
  objectPrompt: string,
  roomId: string,
): string {
  const book = pixelPrompts();
  const key = roomId.startsWith("m") ? roomId.slice(0, 2) : roomId.slice(0, 2);
  const room = book.rooms.get(key);
  return joinParts([
    book.tone,
    book.seam,
    objectPrompt,
    room ? `from ${room.heading}` : null,
    "single object, isolated, off-center",
  ]);
}

export function portraitPrompt(figureId: string, state: 0 | 1 | 2 | 3): string {
  const book = pixelPrompts();
  const figure = book.figures.get(figureId);
  if (!figure) throw new Error(`prompts-pixelart.md has no figure ${figureId}`);
  return joinParts([
    book.style,
    "portrait bust, three-quarter view, off-center composition, looking at viewer",
    figure.body,
    book.states[state],
    book.tone,
    figure.seam && book.seam,
  ]);
}
