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
 * Touching a thing used to throw you somewhere else — LSD: Dream Emulator's linking,
 * which Osamu Sato built out of crashing into walls in racing games. That is gone. The
 * destinations survive it: they are `rift` thresholds now, and you walk through them.
 *
 * Must stay free of DOM *and* node APIs — the CLI and the browser both import it.
 */

import type { CellGrid, Direction, SolidRect } from "./roomGrid";
import type { DoorTypeName } from "./tilecodes";

/**
 * A place, or one of the four gaps between places.
 *
 * `meta` rooms are the parts of a dream nobody remembers — the ones you fall into when
 * you touch the wrong thing. They have no figures and no doors of their own, and you
 * leave on a timer rather than through anything.
 */
export type RoomKind = "place" | "meta";

export type HotspotKind =
  /** Look at it. The safe channel — costs nothing but time. */
  | "look"
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
  /**
   * Shown instead of examining it, when the answer is authored refusal.
   *
   * §02's pear behind the classroom glass: «достать её нельзя, это проверено». A refusal
   * that is authored reads as a rule; a refusal that is missing reads as a bug. It never
   * reaches the model — there is nothing for it to add.
   */
  refusal: string | null;
  /** Set when `kind === "clue"`. */
  clueId: string | null;
  /** A loose PNG under `assets/`, once the object has been drawn. */
  image?: string | null;
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
 * What kind of threshold this is — orthogonal to whether it is locked.
 *
 * Deliberately not folded into `DoorTypeName`, which answers exactly one question:
 * "does it let the sanitar through *right now*". All six of its values are lock policy.
 * Mixing the two would mean you could never author a locked lift or a lever-gated
 * staircase, and — worse — `retypeDoor` is in the sleeper's vocabulary, so the first
 * time it retyped a rift the схизо-створ would quietly become an ordinary door and take
 * the band-tear with it. `sealDoor` → `sealHistory` → `openDoor` round-trips through
 * `type` too, so the two concepts would corrupt each other.
 */
export type ThresholdKind =
  /** An ordinary way through. Continuous: you walked, and the room changed. */
  | "door"
  /** Up or down one floor of the same building. The honest part of the map. */
  | "stair"
  /** §07: «кнопки вниз физически нет». One way, always up. */
  | "lift"
  /**
   * The створ that does not lead where it should — what every LSD link became.
   *
   * §4.1: «Комнаты соединяются без логики, но переход всегда через порог. Дверь,
   * лестница, лифт… Никаких телепортов на ровном месте — всегда есть створ, через
   * который прошли.» The destination stays illogical; only the way in changed.
   */
  | "rift";

export const THRESHOLD_KINDS = ["door", "stair", "lift", "rift"] as const;

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
  threshold: ThresholdKind;
  /**
   * Floors climbed. 0 for a door or a rift, ±1 for a staircase, +1 for a lift.
   *
   * Only a `stair` is checked against the destination's `level`. A lift that goes up and
   * arrives lower is §07's joke, not a bug, and a rift is illogical by definition.
   */
  levelDelta: number;
  /** Which side the walker comes from. Null means any side that is walkable. */
  facing: Direction | null;
  /**
   * A rift only: follow a figure instead of a fixed room.
   *
   * §13's «диванчик, на котором спит Лёша» goes wherever Лёша went. Resolved live, with
   * `toRoomId` as the fallback for when he is no longer anywhere.
   */
  toFigureId: string | null;
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
  /**
   * Live in the player as `DreamFx`. Same four looks for every dream; the Lord
   * only picks which room wears which.
   */
  glitchPreset: "none" | "split" | "double-edge" | "wrong-palette";
}

export interface MetaConfig {
  /** §Part II — «от восьми до сорока секунд». */
  minMs: number;
  maxMs: number;
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
  /**
   * Which structure this room belongs to, or null for anywhere with no upstairs.
   *
   * Twenty of twenty-nine rooms are not in a building — the autumn forest, the mountain,
   * the metro, the dome with no walls — so null is a first-class answer, not a gap.
   */
  buildingId: string | null;
  /** Floor within the building. 0 outside one. Ground level is 1 where it is named. */
  level: number;
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
