/**
 * Characters, as palette-swapped silhouettes.
 *
 * §7.3: about twenty silhouettes made once, recoloured to each dream's palette. It is
 * an eight-bit-era trick, it costs nothing, and it is consistent by construction — a
 * figure can never wander out of the dream's colours because it has none of its own.
 * §7.2 forbids generated animation, so a walk is two frames and that is the style.
 *
 * The silhouettes here are drawn in code rather than by a person, which is the one part
 * of this the concept says to replace first: an artist's twenty shapes would beat these
 * immediately, and nothing else in the pipeline would have to change.
 */

import type { Palette, PaletteRole } from "../../../src/shared/dream";
import { Raster } from "../../../src/shared/art/raster";

export const SPRITE_PX = 16;
export const DIRECTIONS = ["s", "n", "e", "w"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const WALK_FRAMES = 2;

/** Four builds, so a room of figures does not read as one person standing four times. */
export const ARCHETYPES = ["orderly", "visitor", "child", "watcher"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

interface Build {
  /** Top of the head. Lower means a shorter character. */
  headTop: number;
  headWidth: number;
  shoulderWidth: number;
  /** Extra mark that makes this build identifiable in a crowd. */
  detail: "none" | "cap" | "long" | "hunched";
}

const BUILDS: Record<Archetype, Build> = {
  orderly: { headTop: 2, headWidth: 4, shoulderWidth: 7, detail: "cap" },
  visitor: { headTop: 2, headWidth: 4, shoulderWidth: 6, detail: "long" },
  child: { headTop: 5, headWidth: 4, shoulderWidth: 5, detail: "none" },
  watcher: { headTop: 1, headWidth: 4, shoulderWidth: 6, detail: "hunched" },
};

/** The sanitar. Slightly taller than anyone the dream made, which is the point. */
const PLAYER_BUILD: Build = {
  headTop: 2,
  headWidth: 4,
  shoulderWidth: 6,
  detail: "none",
};

interface DrawOptions {
  body: PaletteRole;
  shade: PaletteRole;
  accent: PaletteRole;
}

function drawFigure(
  palette: Palette,
  build: Build,
  dir: Direction,
  frame: number,
  options: DrawOptions,
): Raster {
  const r = new Raster(SPRITE_PX, SPRITE_PX, palette);
  const cx = SPRITE_PX / 2;

  const profile = dir === "e" || dir === "w";
  const headW = profile ? build.headWidth - 1 : build.headWidth;
  const shoulderW = profile ? build.shoulderWidth - 2 : build.shoulderWidth;

  const headX = Math.floor(cx - headW / 2);
  const headTop = build.headTop;
  const headBottom = headTop + 4;
  const torsoTop = headBottom;
  const torsoBottom = 12;
  const torsoX = Math.floor(cx - shoulderW / 2);

  // Feet land on the same row whatever the build, so figures share a ground line.
  const footRow = SPRITE_PX - 2;

  // Shadow first, so the body sits on top of it.
  r.rect(torsoX, footRow, shoulderW, 1, "floorShadow");

  // Legs. The whole animation is here: one frame apart, one frame together.
  const legTop = torsoBottom;
  const strideOut = frame === 1;
  const legLeftX = torsoX + (strideOut ? 0 : 1);
  const legRightX = torsoX + shoulderW - (strideOut ? 1 : 2);
  r.rect(legLeftX, legTop, 2, footRow - legTop, options.shade);
  r.rect(
    legRightX,
    legTop,
    2,
    footRow - legTop + (strideOut ? -1 : 0),
    options.shade,
  );

  // Torso.
  r.rect(torsoX, torsoTop, shoulderW, torsoBottom - torsoTop, options.body);
  if (build.detail === "hunched")
    r.rect(torsoX, torsoTop, shoulderW, 1, options.shade);
  if (build.detail === "long")
    r.rect(torsoX, torsoBottom - 2, shoulderW, 3, options.body);

  // Arms: a darker column at each edge, and in profile only one of them shows.
  if (profile) {
    const armX = dir === "e" ? torsoX + shoulderW - 1 : torsoX;
    r.vLine(armX, torsoTop + 1, torsoBottom - 1, options.shade);
  } else {
    r.vLine(torsoX, torsoTop + 1, torsoBottom - 1, options.shade);
    r.vLine(
      torsoX + shoulderW - 1,
      torsoTop + 1,
      torsoBottom - 1,
      options.shade,
    );
  }

  // Head.
  r.rect(headX, headTop, headW, headBottom - headTop, options.body);

  if (dir === "s") {
    // Eyes. Two dark pixels are enough to make something look back at you.
    r.set(headX + 1, headTop + 2, r.index(options.shade));
    r.set(headX + headW - 2, headTop + 2, r.index(options.shade));
  } else if (dir === "n") {
    // Back of the head: hair, no face.
    r.rect(headX, headTop, headW, 2, options.shade);
  } else {
    // Profile: one eye, set forward.
    const eyeX = dir === "e" ? headX + headW - 2 : headX + 1;
    r.set(eyeX, headTop + 2, r.index(options.shade));
    r.rect(
      dir === "e" ? headX : headX + headW - 1,
      headTop,
      1,
      3,
      options.shade,
    );
  }

  if (build.detail === "cap") {
    r.rect(headX - 1, headTop, headW + 2, 1, options.accent);
    r.rect(headX, headTop + 1, headW, 1, options.accent);
  }

  return r;
}

export interface SpriteFrames {
  /** Keyed `<prefix>_<dir>_<frame>`, e.g. `player_s_1`. */
  [name: string]: Raster;
}

function framesFor(
  prefix: string,
  palette: Palette,
  build: Build,
  options: DrawOptions,
): SpriteFrames {
  const out: SpriteFrames = {};
  for (const dir of DIRECTIONS) {
    for (let frame = 0; frame < WALK_FRAMES; frame++) {
      out[`${prefix}_${dir}_${frame}`] = drawFigure(
        palette,
        build,
        dir,
        frame,
        options,
      );
    }
  }
  return out;
}

export function buildPlayerFrames(palette: Palette): SpriteFrames {
  return framesFor("player", palette, PLAYER_BUILD, {
    body: "player",
    shade: "wallEdge",
    accent: "highlight",
  });
}

export function buildFigureFrames(palette: Palette): SpriteFrames {
  const out: SpriteFrames = {};
  for (const archetype of ARCHETYPES) {
    Object.assign(
      out,
      framesFor(`figure_${archetype}`, palette, BUILDS[archetype], {
        body: "figure",
        shade: "wallEdge",
        accent: "accent",
      }),
    );
  }
  return out;
}

/** Frame name the renderer asks for. Kept here so both sides agree on the spelling. */
export function frameName(
  prefix: string,
  dir: Direction,
  frame: number,
): string {
  return `${prefix}_${dir}_${frame % WALK_FRAMES}`;
}
