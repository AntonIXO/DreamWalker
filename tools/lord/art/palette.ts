/**
 * Palettes.
 *
 * §7.1 is blunt about why this exists: slop is what you get when every asset comes
 * from its own universe. Fixing twelve to sixteen colours at the level of the *dream*
 * — not per tile, not per generation — is the cheapest constraint that keeps a whole
 * world looking like one place, and it is the constraint every later art source has to
 * obey, generated or hand-drawn.
 *
 * Each palette lists exactly one colour per role, in the order of `PALETTE_ROLES`, so
 * the role table is an identity mapping and a Lord editing dream.json by hand can see
 * at a glance which colour does what.
 */

import {
  PALETTE_ROLES,
  type Palette,
  type PaletteRole,
} from "../../../src/shared/dream";
import { chroma, parseHex, toOklab } from "../../../src/shared/art/oklab";
import type { StyleProfile } from "../../../src/shared/art/style";

interface PaletteSpec {
  name: string;
  description: string;
  /** One hex colour per entry of PALETTE_ROLES, in that exact order. */
  colors: string[];
}

const SPECS: PaletteSpec[] = [
  {
    name: "ash",
    description: "cold institutional grey, the default hospital dream",
    colors: [
      "#0a0a0d", // background
      "#2b2f38", // floor
      "#333845", // floorAlt
      "#1b1e25", // floorShadow
      "#242832", // threshold
      "#3d4351", // wall
      "#4a5162", // wallFace
      "#161920", // wallEdge
      "#5c6678", // doorOpen
      "#8a6a3c", // doorLocked
      "#5a2f2f", // doorSealed
      "#9fb3c8", // accent
      "#6b7280", // prop
      "#c2b8a3", // figure
      "#e8e4dc", // player
      "#f0c674", // highlight
    ],
  },
  {
    name: "ember",
    description: "banked fire, brown and orange, something burned here",
    colors: [
      "#0d0806",
      "#3a2620",
      "#452e26",
      "#241713",
      "#31201b",
      "#553a2e",
      "#67483a",
      "#1a100d",
      "#7a5340",
      "#c07a3a",
      "#6e2b22",
      "#e0a060",
      "#8a6650",
      "#d9c0a0",
      "#f5e6d3",
      "#ff9d4d",
    ],
  },
  {
    name: "bruise",
    description: "violet and green, a dream that has gone slightly wrong",
    colors: [
      "#0a070f",
      "#2c2140",
      "#35284c",
      "#1c1429",
      "#261c37",
      "#443458",
      "#544067",
      "#150f1f",
      "#6b5480",
      "#9d6b3f",
      "#5e2748",
      "#8fd694",
      "#6d5a85",
      "#c4b5d6",
      "#efe7f5",
      "#a8f0b0",
    ],
  },
  {
    name: "signal",
    description: "near-monochrome with one live colour, harsh and clean",
    colors: [
      "#08090a",
      "#20242a",
      "#282d34",
      "#141619",
      "#1b1f24",
      "#343a43",
      "#414954",
      "#101215",
      "#525b68",
      "#7d6a3a",
      "#4a2222",
      "#39d0c4",
      "#5f6975",
      "#b8bfc9",
      "#eef2f6",
      "#39d0c4",
    ],
  },
];

function toPalette(spec: PaletteSpec): Palette {
  if (spec.colors.length !== PALETTE_ROLES.length) {
    throw new Error(
      `palette "${spec.name}" has ${spec.colors.length} colours, expected ${PALETTE_ROLES.length}`,
    );
  }
  const roles = {} as Record<PaletteRole, number>;
  PALETTE_ROLES.forEach((role, i) => {
    roles[role] = i;
  });
  return { name: spec.name, colors: spec.colors.slice(), roles };
}

export const PALETTES: Record<string, Palette> = Object.fromEntries(
  SPECS.map((spec) => [spec.name, toPalette(spec)]),
);

export const PALETTE_CHOICES = SPECS.map((spec) => ({
  label: spec.name,
  detail: spec.description,
  value: spec.name,
}));

export function paletteByName(name: string): Palette {
  const palette = PALETTES[name];
  if (!palette) {
    throw new Error(
      `unknown palette "${name}". Known: ${Object.keys(PALETTES).join(", ")}`,
    );
  }
  return palette;
}

/** Look up the colour a role points at. The only sanctioned way to read a palette. */
export function roleColor(palette: Palette, role: PaletteRole): string {
  const index = palette.roles[role];
  const hex = palette.colors[index];
  if (!hex)
    throw new Error(`palette "${palette.name}" has no colour for role ${role}`);
  return hex;
}

// ---------------------------------------------------------------------------
// Palettes taken from a reference image
// ---------------------------------------------------------------------------

/**
 * Where each role wants to sit on the dark-to-light ramp, 0 = darkest, 1 = lightest.
 *
 * The built-in palettes are hand-ordered so their role table is the identity. A palette
 * lifted off a picture has no such order — it is just the sixteen colours that picture
 * used — so the roles have to be *placed*, and the only thing reliably comparable between
 * an artist's palette and a tile's needs is relative lightness. A wall reads as a wall
 * because it is darker than the floor in front of it; which hue it happens to be is the
 * dream's business, not the renderer's.
 */
const ROLE_LIGHTNESS: Record<PaletteRole, number> = {
  background: 0.0,
  wallEdge: 0.08,
  floorShadow: 0.16,
  doorSealed: 0.24,
  threshold: 0.34,
  floor: 0.42,
  floorAlt: 0.48,
  wall: 0.56,
  wallFace: 0.64,
  prop: 0.6,
  doorOpen: 0.7,
  doorLocked: 0.62,
  accent: 0.5,
  figure: 0.82,
  player: 0.92,
  highlight: 1.0,
};

/** Roles pinned to a measured colour rather than placed by lightness. */
const PINNED: Partial<Record<PaletteRole, keyof StyleProfile>> = {
  accent: "accentIndex",
  background: "outlineIndex",
};

/**
 * Build a `Palette` from colours pulled out of a reference image.
 *
 * Roles may share an index and often do — sixteen roles over sixteen colours is not a
 * bijection, because two roles wanting the same lightness genuinely want the same colour.
 */
export function paletteFromReference(
  name: string,
  colors: readonly string[],
  style: StyleProfile,
): Palette {
  // Rank by perceptual lightness, not by the order they came in.
  const order = colors
    .map((hex, index) => ({ index, lab: toOklab(parseHex(hex)) }))
    .sort((a, b) => a.lab.L - b.lab.L);

  const roles = {} as Record<PaletteRole, number>;
  for (const role of PALETTE_ROLES) {
    const pin = PINNED[role];
    if (pin) {
      roles[role] = style[pin] as number;
      continue;
    }
    const target = ROLE_LIGHTNESS[role];
    const slot = Math.round(target * (order.length - 1));
    roles[role] = order[Math.max(0, Math.min(order.length - 1, slot))]!.index;
  }

  // The background is the void outside the dream and the outline colour is the darkest
  // thing in the picture, which is usually the same colour — but if the reference's
  // outline is light (white-on-dark art), fall back to the genuinely darkest entry so the
  // world does not glow at its edges.
  if (toOklab(parseHex(colors[roles.background]!)).L > 0.35) {
    roles.background = order[0]!.index;
  }

  // An accent that is not actually colourful is not an accent. Sooner have none than a
  // grey one masquerading as the dream's one live colour (§7).
  if (chroma(toOklab(parseHex(colors[roles.accent]!))) < 0.02) {
    const brightest = colors
      .map((hex, index) => ({ index, c: chroma(toOklab(parseHex(hex))) }))
      .sort((a, b) => b.c - a.c)[0];
    if (brightest) roles.accent = brightest.index;
  }

  return { name, colors: [...colors], roles };
}
