/**
 * A room, as the Lord authored it.
 *
 * Format 3 kept one flat tile grid for the whole dream and cut rooms out of it as
 * rectangles, because the space was *generated* and a generator needs somewhere to
 * grow. Format 4 authors rooms by hand, so a room is a discrete scene again: its own
 * walk mask, its own props, its own doors, its own picture. Nothing is dealt onto a
 * slot; a room is simply where it is.
 *
 * The shape is the prep-room lobby's (`src/player/lobby/definition.ts`) — an ASCII cell
 * grid plus rects plus hotspots — because that room was hand-authored from the start and
 * turned out to be the right shape for all of them.
 *
 * Two mechanics from `dream-walker-new/rooms.md` live in this file rather than in code:
 *
 *   - **Линк** — touching a thing throws you somewhere else (LSD: Dream Emulator's
 *     mechanic; Osamu Sato built it out of crashing into walls in racing games). A link
 *     is authored per object, so poking the world stops being purely safe: it costs you
 *     your position instead of your cover.
 *   - **Тонус** — every room and every object nudges the hidden coordinate in
 *     `src/shared/tonus.ts`.
 *
 * Must stay free of DOM *and* node APIs — the CLI and the browser both import it.
 */

import type { CellGrid, Direction, SolidRect } from "./roomGrid";
import type { DoorTypeName } from "./tilecodes";
import type { TonusDelta } from "./tonus";

/**
 * A place, or one of the four gaps between places.
 *
 * `meta` rooms are the parts of a dream nobody remembers — the ones you fall into when
 * you touch the wrong thing. They have no figures and no doors, you leave on a timer
 * rather than through anything, and they are the only rooms where the tonus counter is
 * allowed to overflow.
 */
export type RoomKind = "place" | "meta";

/** Where a link throws you. */
export type RoomLink =
  /** Another room, optionally at a named entry. */
  | { to: "room"; roomId: string; entryId: string | null }
  /**
   * Wherever a figure currently is — «диванчик, на котором спит Лёша» follows Лёша
   * when the heartbeat moves him.
   */
  | { to: "figure"; characterId: string }
  /**
   * Nothing happens, on purpose. §02's pear behind the classroom glass: «достать её
   * нельзя, это проверено». A refusal that is authored reads as a rule; a refusal that
   * is missing reads as a bug.
   */
  | { to: "refuse"; note: string }
  /** §07's one-way lift: always one floor up, never down. */
  | { to: "up" };

export type HotspotKind =
  /** Look at it. The safe channel — costs nothing but time. */
  | "look"
  /** Touching it moves you. */
  | "link"
  /** Carries one of the six words. */
  | "clue"
  /** A figure stands here. */
  | "figure"
  /** Lobby-side only: opens a panel rather than touching the dream. */
  | "ui";

export interface RoomHotspot {
  id: string;
  kind: HotspotKind;
  /** Tile coordinates, fractional. Where the sanitar must stand near. */
  x: number;
  y: number;
  /** Reach in tiles. A property of the thing, not of the sanitar. */
  reach: number;
  /** Russian, shown as `E — <prompt>`. */
  prompt: string;
  link: RoomLink | null;
  /** Applied when touched, before any teleport. */
  tonus: TonusDelta | null;
  /** Set when `kind === "clue"`. */
  clueId: string | null;
  /** Set when `kind === "ui"` — which panel to open. */
  action: string | null;
  /** Whether it fires once per cycle or every time. */
  once: boolean;
  /**
   * Milliseconds of standing still nearby before it fires by itself.
   *
   * §12's тётя: sitting behind her for a minute and a half is worth (−7,−7), and the
   * player has to choose to spend the time. Null means it only fires on E.
   */
  dwellMs: number | null;
}

/** A thing standing in the room. Larger than a tile, unlike an atlas prop. */
export interface RoomProp extends SolidRect {
  id: string;
  /** An atlas role to tile it with, or null when the backdrop already draws it. */
  role: string | null;
  /** A loose PNG under `assets/`, for props too big or too specific for the atlas. */
  image: string | null;
}

/** Somewhere a walker can arrive. Every room needs at least one. */
export interface RoomEntry {
  id: string;
  /** Tile coordinates, fractional. */
  x: number;
  y: number;
  facing: Direction;
}

/**
 * A threshold you walk through, rather than a tile you step on.
 *
 * Format 3 spread a door across nine tiles of a shared grid; a rect is the same idea
 * without the arithmetic. Whether it opens still depends on what the sanitar is
 * carrying — that lives in `canPassDoor`, not in the geometry.
 */
export interface RoomDoor {
  id: string;
  /** Tile rect. Walking into it is what opens it. */
  x: number;
  y: number;
  w: number;
  h: number;
  toRoomId: string;
  toEntryId: string | null;
  type: DoorTypeName;
  /** For `keyLock` doors, which key passes. */
  keyId: string | null;
  /** Russian; overrides the default refusal line. */
  prompt: string | null;
}

export interface RoomGraphics {
  /** Existing atlas roles, used where the backdrop does not cover. */
  floorRole: string;
  wallRole: string;
  propRole: string;
  /** Authored PNG relative to the published dream, or null while the room is grey. */
  backdropImage: string | null;
  /**
   * `cells` fits the backdrop to the room's tile rect; `screen` bleeds it to the whole
   * 640×360 frame, which is what a meta-space is — one picture, no edges.
   */
  backdropFit: "cells" | "screen";
  glitchPreset: "none" | "split" | "double-edge" | "wrong-palette";
}

export interface MetaConfig {
  /** §Part II — «от восьми до сорока секунд». */
  minMs: number;
  maxMs: number;
  /**
   * М1 КОРНИ: «(0, 0), но удваивает предыдущий сдвиг». Arriving with −6 leaves with
   * −12, which is how a meta-space becomes the place an overflow finally happens.
   */
  doublesPrevious: boolean;
  /** Whether the tonus counter may wrap here. Everywhere else it clamps. */
  overflow: boolean;
}

/** Where a figure stands. Named, so a patch can move someone without arithmetic. */
export interface FigureSlot {
  id: string;
  /** Tile coordinates, fractional. */
  x: number;
  y: number;
}

export interface DreamRoom extends CellGrid {
  id: string;
  /** Shown in the HUD. */
  name: string;
  kind: RoomKind;
  tileSize: number;
  width: number;
  height: number;
  /** One row per tile row, one character per tile. See `roomGrid.ts` for the alphabet. */
  cells: string[];
  /**
   * Named alternate walk masks, same dimensions.
   *
   * §13's underground halls rebuild «как камеры в Portal 2», and §17's shower shrinks
   * 3% per pass. Both are the sleeper moving walls, and both are authored rather than
   * generated, so they cost no art and can never produce an unwalkable room by accident.
   */
  cellVariants: Record<string, string[]>;
  props: RoomProp[];
  hotspots: RoomHotspot[];
  entries: RoomEntry[];
  doors: RoomDoor[];
  figureSlots: FigureSlot[];
  graphics: RoomGraphics;
  /** `frame` snaps the camera to the whole room; `follow` tracks the walker. */
  camera: "frame" | "follow";
  /** Applied on entry, scaled by how many times you have been here. */
  tonus: TonusDelta;
  /**
   * §4.3 — «второй визит хуже первого». The canonical case is §06: the same ditch, but
   * this time there are two of them. Not a punishment; arithmetic.
   */
  revisit: { escalates: boolean; note: string | null };
  meta: MetaConfig | null;
  /** Authored prose. Feeds the sleeper's prompt, never shown verbatim. */
  description: string;
  atmosphere: string;
  personality: string;
  tags: string[];
  /** Every other Russian string this room needs, keyed however the author likes. */
  copy: Record<string, string>;
}

/** Where the sanitar arrives at the start of a cycle. */
export interface DreamSpawn {
  roomId: string;
  entryId: string;
}
