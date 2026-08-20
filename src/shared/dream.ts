/**
 * The dream artifact: everything the Lord authored, and the only thing the player loads.
 *
 * §8 of the concept — one server, one dream, one secret, one playthrough. This file is
 * the contract between the two programs. The `lord` CLI is the only writer; the web
 * player is a pure reader. Nothing here is generated at runtime.
 *
 * The artifact describes the dream's *starting state*. Once play begins the heartbeat
 * mutates a live copy of it (§6, "дальше карта плывёт"); the artifact on disk never changes.
 *
 * ## Format 4
 *
 * Format 3 carried one flat tile grid for the whole dream, plus a mission graph that
 * proved the *generated* space was crossable. Both existed to serve generation. The
 * rooms are authored by hand now (`dream-walker-new/rooms.md`), so the grid became a
 * list of rooms and the graph became the author's problem — an authored dream states its
 * own edges, and `lord rooms --check` walks them from the spawn to prove nothing is
 * stranded. What used to be a chamber "dealt onto" a room slot is now simply the room.
 */

import type { StyleProfile } from "./art/style";
import type { DreamContent } from "./content";
import { THRESHOLD_KINDS, type DreamRoom, type DreamSpawn } from "./room";
import { DOOR_TYPES, type DoorTypeName } from "./tilecodes";

export const DREAM_FORMAT_VERSION = 5;

/** Tile-space rectangle. Still the unit the camera frames a room in. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * §2 — the Lord seeds a few hooks and stops there. This is not a schema of the
 * solution and there is no solver: the mind decides who ends up holding what, and
 * may move them while you play.
 */
export interface Shard {
  id: string;
  /** What this hook is, in the Lord's words. Never shown verbatim to the player. */
  hint: string;
}

/**
 * Where a figure starts.
 *
 * Position is a named slot in the room rather than a coordinate, so the heartbeat can
 * move someone without hunting for a free floor tile — and so an author can move the
 * slot without every patch that ever referenced it going stale.
 */
export interface FigurePlacement {
  id: string;
  archetypeId: string;
  name: string;
  roomId: string;
  slotId: string;
  holdsShardId: string | null;
}

export interface CycleConfig {
  /** How long before the patient surfaces and the dream restarts (§5). */
  durationMs: number;
  /**
   * Cycles before the sanitar is thrown out with whatever they have — «Не сложилось»
   * in `endings.md`, which sets it at four. Null means unlimited.
   */
  maxCycles: number | null;
}

export interface HeartbeatConfig {
  /** How often the sleeper wakes enough to rearrange things around you. */
  intervalMs: number;
  /** Ceiling on model calls per cycle once a real mind is wired in (§10, cost). */
  callBudgetPerCycle: number;
  /** How much the dream may change in one beat. Low numbers read as unease, high as chaos. */
  maxPatchesPerBeat: number;
}

// ---------------------------------------------------------------------------
// Palette (§7.1 — fixed at the level of the dream, not per asset)
// ---------------------------------------------------------------------------

export const PALETTE_ROLES = [
  "background",
  "floor",
  "floorAlt",
  "floorShadow",
  "threshold",
  "wall",
  "wallFace",
  "wallEdge",
  "doorOpen",
  "doorLocked",
  "doorSealed",
  "accent",
  "prop",
  "figure",
  "player",
  "highlight",
] as const;

export type PaletteRole = (typeof PALETTE_ROLES)[number];

/**
 * §7.1 wants twelve to sixteen, and sixteen stays the default for the atlas, which is an
 * indexed PNG and cannot hold more. The ceiling is higher because the loose art — room
 * backdrops, portraits — is not bound by the atlas, and `prompts-pixelart.md` locks the
 * generated art to a 28-colour palette measured off the reference image.
 */
export const MAX_PALETTE_COLORS = 32;
export const DEFAULT_PALETTE_COLORS = 16;

export interface Palette {
  name: string;
  /** Hex, `#rrggbb`. The whole dream is drawn from these and nothing else. */
  colors: string[];
  /** Which index in `colors` each role points at. Several roles may share a colour. */
  roles: Record<PaletteRole, number>;
}

// ---------------------------------------------------------------------------
// The artifact
// ---------------------------------------------------------------------------

export interface DreamArtifact {
  format: number;
  slug: string;
  title: string;
  /** §6 — what a miracle looks like here. Without it, later adaptations show their seams. */
  genreContract: string;
  /** §7.1 — 3 to 5 words of art direction, fixed for the whole dream. */
  styleWords: string[];
  /**
   * SHA-256 of the one immutable line (§2). The plaintext lives only in
   * dreams/<slug>/secret.local.txt, which is gitignored and never served.
   */
  secretHash: string;
  shards: Shard[];
  palette: Palette;
  /**
   * §7.1 measured rather than declared — outline colour, shading ramps, dither density,
   * usually read off the Lord's reference image.
   */
  style: StyleProfile;
  /** Every room in the dream, authored by hand. */
  rooms: DreamRoom[];
  /** Where the sanitar arrives at the start of every cycle. */
  spawn: DreamSpawn;
  /** The last door — the room the Eye is in. Replaces format 3's `graph.endId`. */
  finaleRoomId: string;
  figures: FigurePlacement[];
  /** Human-authored personality and mnemonic records. */
  content: DreamContent;
  cycle: CycleConfig;
  heartbeat: HeartbeatConfig;
  /** Path to the atlas manifest, relative to the artifact directory. */
  atlas: string;
  authoredAt: string;
}

// ---------------------------------------------------------------------------
// Atlas manifest
// ---------------------------------------------------------------------------

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasManifest {
  format: number;
  /** Image filename, relative to the manifest. */
  image: string;
  tileSize: number;
  frames: Record<string, AtlasFrame>;
  /** Role -> ordered frame names. Several frames means the renderer varies them. */
  roleFrames: Record<string, string[]>;
  /**
   * §7.4 — which of the four candidates the Lord picked, per role. Kept as provenance:
   * when the art is regenerated later, this is the record of what a human chose.
   */
  chosen: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Hand-written rather than schema-driven, because the useful errors here are
 * relational — a threshold pointing at a room that does not exist, a door arriving at an
 * entry nobody authored — and those read better as prose than as a schema violation path.
 */
export class DreamValidationError extends Error {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(`${path}: ${message}`);
    this.name = "DreamValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new DreamValidationError(message, path);
}

function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "expected a string");
  return value;
}

function num(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    fail(path, "expected a number");
  return value;
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function optionalStr(value: unknown, path: string): string | null {
  if (value === null || value === undefined) return null;
  return str(value, path);
}

/** Collected on the first pass so doors can be checked on the second. */
interface RoomIndex {
  entryIds: Map<string, Set<string>>;
  slotIds: Map<string, Set<string>>;
  kinds: Map<string, string>;
  levels: Map<string, number>;
  buildings: Map<string, string | null>;
}

/**
 * Structure of one room. Cross-room references are deliberately *not* checked here —
 * they need every room id first, so they happen on a second pass.
 */
function validateRoomShape(
  value: unknown,
  path: string,
): Record<string, unknown> {
  const room = obj(value, path);
  str(room.id, `${path}.id`);
  str(room.name, `${path}.name`);
  const kind = str(room.kind, `${path}.kind`);
  if (kind !== "place" && kind !== "meta") {
    fail(`${path}.kind`, `expected "place" or "meta", got ${kind}`);
  }

  const width = num(room.width, `${path}.width`);
  const height = num(room.height, `${path}.height`);
  if (width < 1 || height < 1) fail(path, "a room needs a positive size");
  num(room.tileSize, `${path}.tileSize`);

  const cells = arr(room.cells, `${path}.cells`);
  if (cells.length !== height) {
    fail(`${path}.cells`, `expected ${height} rows, got ${cells.length}`);
  }
  cells.forEach((row, i) => {
    const line = str(row, `${path}.cells[${i}]`);
    if (line.length !== width) {
      fail(
        `${path}.cells[${i}]`,
        `expected ${width} characters, got ${line.length}`,
      );
    }
  });

  // A variant that is not the same shape would change the room's size mid-cycle.
  const variants = obj(room.cellVariants, `${path}.cellVariants`);
  for (const [name, rows] of Object.entries(variants)) {
    const list = arr(rows, `${path}.cellVariants.${name}`);
    if (list.length !== height) {
      fail(`${path}.cellVariants.${name}`, `expected ${height} rows`);
    }
    list.forEach((row, i) => {
      if (str(row, `${path}.cellVariants.${name}[${i}]`).length !== width) {
        fail(
          `${path}.cellVariants.${name}[${i}]`,
          `expected ${width} characters`,
        );
      }
    });
  }

  const inside = (x: number, y: number, at: string): void => {
    if (x < 0 || y < 0 || x > width || y > height) {
      fail(at, `(${x}, ${y}) is outside the ${width}x${height} room`);
    }
  };

  const entryIds = new Set<string>();
  const entries = arr(room.entries, `${path}.entries`);
  if (entries.length === 0) {
    fail(`${path}.entries`, "a room needs somewhere to arrive");
  }
  entries.forEach((value, i) => {
    const entry = obj(value, `${path}.entries[${i}]`);
    const id = str(entry.id, `${path}.entries[${i}].id`);
    if (entryIds.has(id))
      fail(`${path}.entries[${i}].id`, `duplicate entry ${id}`);
    entryIds.add(id);
    inside(
      num(entry.x, `${path}.entries[${i}].x`),
      num(entry.y, `${path}.entries[${i}].y`),
      `${path}.entries[${i}]`,
    );
    str(entry.facing, `${path}.entries[${i}].facing`);
  });

  const slotIds = new Set<string>();
  arr(room.figureSlots, `${path}.figureSlots`).forEach((value, i) => {
    const slot = obj(value, `${path}.figureSlots[${i}]`);
    const id = str(slot.id, `${path}.figureSlots[${i}].id`);
    if (slotIds.has(id))
      fail(`${path}.figureSlots[${i}].id`, `duplicate slot ${id}`);
    slotIds.add(id);
    inside(
      num(slot.x, `${path}.figureSlots[${i}].x`),
      num(slot.y, `${path}.figureSlots[${i}].y`),
      `${path}.figureSlots[${i}]`,
    );
  });

  arr(room.props, `${path}.props`).forEach((value, i) => {
    const prop = obj(value, `${path}.props[${i}]`);
    str(prop.id, `${path}.props[${i}].id`);
    const x = num(prop.x, `${path}.props[${i}].x`);
    const y = num(prop.y, `${path}.props[${i}].y`);
    const w = num(prop.w, `${path}.props[${i}].w`);
    const h = num(prop.h, `${path}.props[${i}].h`);
    inside(x, y, `${path}.props[${i}]`);
    inside(x + w, y + h, `${path}.props[${i}]`);
    bool(prop.solid, `${path}.props[${i}].solid`);
    optionalStr(prop.role, `${path}.props[${i}].role`);
    optionalStr(prop.image, `${path}.props[${i}].image`);
  });

  const hotspotIds = new Set<string>();
  arr(room.hotspots, `${path}.hotspots`).forEach((value, i) => {
    const hotspot = obj(value, `${path}.hotspots[${i}]`);
    const id = str(hotspot.id, `${path}.hotspots[${i}].id`);
    if (hotspotIds.has(id))
      fail(`${path}.hotspots[${i}].id`, `duplicate hotspot ${id}`);
    hotspotIds.add(id);
    str(hotspot.kind, `${path}.hotspots[${i}].kind`);
    str(hotspot.prompt, `${path}.hotspots[${i}].prompt`);
    inside(
      num(hotspot.x, `${path}.hotspots[${i}].x`),
      num(hotspot.y, `${path}.hotspots[${i}].y`),
      `${path}.hotspots[${i}]`,
    );
    if (num(hotspot.reach, `${path}.hotspots[${i}].reach`) <= 0) {
      fail(
        `${path}.hotspots[${i}].reach`,
        "a hotspot you cannot reach is not one",
      );
    }
    bool(hotspot.once, `${path}.hotspots[${i}].once`);
    optionalStr(hotspot.clueId, `${path}.hotspots[${i}].clueId`);
    optionalStr(hotspot.action, `${path}.hotspots[${i}].action`);
    if (hotspot.dwellMs !== null && hotspot.dwellMs !== undefined) {
      num(hotspot.dwellMs, `${path}.hotspots[${i}].dwellMs`);
    }
  });

  const doorIds = new Set<string>();
  arr(room.doors, `${path}.doors`).forEach((value, i) => {
    const door = obj(value, `${path}.doors[${i}]`);
    const id = str(door.id, `${path}.doors[${i}].id`);
    if (doorIds.has(id)) fail(`${path}.doors[${i}].id`, `duplicate door ${id}`);
    doorIds.add(id);
    const x = num(door.x, `${path}.doors[${i}].x`);
    const y = num(door.y, `${path}.doors[${i}].y`);
    inside(x, y, `${path}.doors[${i}]`);
    inside(
      x + num(door.w, `${path}.doors[${i}].w`),
      y + num(door.h, `${path}.doors[${i}].h`),
      `${path}.doors[${i}]`,
    );
    const type = str(door.type, `${path}.doors[${i}].type`) as DoorTypeName;
    if (!DOOR_TYPES.includes(type)) {
      fail(`${path}.doors[${i}].type`, `unknown door type ${type}`);
    }
    optionalStr(door.keyId, `${path}.doors[${i}].keyId`);
    optionalStr(door.prompt, `${path}.doors[${i}].prompt`);

    const threshold = str(door.threshold, `${path}.doors[${i}].threshold`);
    if (
      !THRESHOLD_KINDS.includes(threshold as (typeof THRESHOLD_KINDS)[number])
    ) {
      fail(`${path}.doors[${i}].threshold`, `unknown threshold ${threshold}`);
    }
    const delta = num(door.levelDelta, `${path}.doors[${i}].levelDelta`);
    if (threshold === "stair" && delta !== 1 && delta !== -1) {
      fail(
        `${path}.doors[${i}].levelDelta`,
        "a staircase climbs exactly one floor",
      );
    }
    // §07: «кнопки вниз физически нет».
    if (threshold === "lift" && delta <= 0) {
      fail(`${path}.doors[${i}].levelDelta`, "a lift only goes up");
    }
    if ((threshold === "door" || threshold === "rift") && delta !== 0) {
      fail(
        `${path}.doors[${i}].levelDelta`,
        `a ${threshold} stays on its floor`,
      );
    }
    const facing = optionalStr(door.facing, `${path}.doors[${i}].facing`);
    if (facing !== null && !["n", "e", "s", "w"].includes(facing)) {
      fail(`${path}.doors[${i}].facing`, `unknown facing ${facing}`);
    }
    const toFigure = optionalStr(
      door.toFigureId,
      `${path}.doors[${i}].toFigureId`,
    );
    // §13's «диванчик, на котором спит Лёша». Only a rift may chase somebody; a
    // staircase that moved would stop being architecture.
    if (toFigure !== null && threshold !== "rift") {
      fail(
        `${path}.doors[${i}].toFigureId`,
        `a ${threshold} does not follow anybody`,
      );
    }
  });

  const graphics = obj(room.graphics, `${path}.graphics`);
  for (const role of [
    "floorRole",
    "wallRole",
    "propRole",
    "glitchPreset",
  ] as const) {
    str(graphics[role], `${path}.graphics.${role}`);
  }
  const fit = str(graphics.backdropFit, `${path}.graphics.backdropFit`);
  if (fit !== "cells" && fit !== "screen") {
    fail(
      `${path}.graphics.backdropFit`,
      `expected "cells" or "screen", got ${fit}`,
    );
  }
  optionalStr(graphics.backdropImage, `${path}.graphics.backdropImage`);

  const camera = str(room.camera, `${path}.camera`);
  if (camera !== "frame" && camera !== "follow") {
    fail(`${path}.camera`, `expected "frame" or "follow", got ${camera}`);
  }

  const buildingId = optionalStr(room.buildingId, `${path}.buildingId`);
  const level = num(room.level, `${path}.level`);
  if (room.originX === undefined || room.originX === null) {
    room.originX = 0;
  } else {
    const originX = num(room.originX, `${path}.originX`);
    if (!Number.isInteger(originX) || originX < 0) {
      fail(`${path}.originX`, "expected a whole tile origin");
    }
  }
  if (room.originY === undefined || room.originY === null) {
    room.originY = 0;
  } else {
    const originY = num(room.originY, `${path}.originY`);
    if (!Number.isInteger(originY) || originY < 0) {
      fail(`${path}.originY`, "expected a whole tile origin");
    }
  }
  if (!Number.isInteger(level)) fail(`${path}.level`, "expected a whole floor");
  if (buildingId === null && level !== 0) {
    fail(`${path}.level`, "a room outside a building is on floor 0");
  }

  const revisit = obj(room.revisit, `${path}.revisit`);
  bool(revisit.escalates, `${path}.revisit.escalates`);
  optionalStr(revisit.note, `${path}.revisit.note`);

  for (const field of ["description", "atmosphere", "personality"] as const) {
    str(room[field], `${path}.${field}`);
  }
  arr(room.tags, `${path}.tags`).forEach((tag, i) =>
    str(tag, `${path}.tags[${i}]`),
  );
  obj(room.copy, `${path}.copy`);

  // A meta-space is defined by what it lacks: no figures, and one picture covering
  // the whole screen. It is on the street map like any other room; you leave through
  // a door. The timer is a leftover for a meta-space that still has none.
  if (kind === "meta") {
    const meta = obj(room.meta, `${path}.meta`);
    const minMs = num(meta.minMs, `${path}.meta.minMs`);
    const maxMs = num(meta.maxMs, `${path}.meta.maxMs`);
    if (minMs <= 0 || maxMs < minMs) {
      fail(
        `${path}.meta`,
        `expected 0 < minMs <= maxMs, got ${minMs}..${maxMs}`,
      );
    }
    // A meta-space *is* one picture — but on the street map it sits in a room rect
    // like anything else (`cells`). `screen` is the leftover full-frame bleed.
  } else if (room.meta !== null && room.meta !== undefined) {
    fail(`${path}.meta`, "only a meta-space carries a meta config");
  }

  return room;
}

/**
 * Validates structure *and* the relational invariants the game depends on, then
 * returns the value typed. Throws `DreamValidationError` with a readable path.
 */
export function validateDreamArtifact(value: unknown): DreamArtifact {
  const root = obj(value, "dream");

  const format = num(root.format, "dream.format");
  if (format !== DREAM_FORMAT_VERSION) {
    fail(
      "dream.format",
      `artifact is format ${format}, this build reads ${DREAM_FORMAT_VERSION}. Re-run \`bun run lord build\`.`,
    );
  }

  str(root.slug, "dream.slug");
  str(root.title, "dream.title");
  str(root.genreContract, "dream.genreContract");
  str(root.secretHash, "dream.secretHash");
  str(root.atlas, "dream.atlas");
  str(root.authoredAt, "dream.authoredAt");

  const styleWords = arr(root.styleWords, "dream.styleWords");
  if (styleWords.length < 1)
    fail("dream.styleWords", "at least one style word is required");
  styleWords.forEach((w, i) => str(w, `dream.styleWords[${i}]`));

  // --- palette
  const palette = obj(root.palette, "dream.palette");
  const colors = arr(palette.colors, "dream.palette.colors");
  if (colors.length < 4 || colors.length > MAX_PALETTE_COLORS) {
    fail(
      "dream.palette.colors",
      `expected 4..${MAX_PALETTE_COLORS} colours, got ${colors.length}`,
    );
  }
  colors.forEach((c, i) => {
    const hex = str(c, `dream.palette.colors[${i}]`);
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
      fail(`dream.palette.colors[${i}]`, `expected #rrggbb, got ${hex}`);
    }
  });
  const roles = obj(palette.roles, "dream.palette.roles");
  for (const role of PALETTE_ROLES) {
    const idx = num(roles[role], `dream.palette.roles.${role}`);
    if (idx < 0 || idx >= colors.length) {
      fail(
        `dream.palette.roles.${role}`,
        `index ${idx} is outside the palette`,
      );
    }
  }

  // --- style. Every index must land inside the palette, or a generated tile would draw
  // with a colour that is not in the dream — which is the one thing §7.1 forbids outright.
  const style = obj(root.style, "dream.style");
  const inPalette = (value: unknown, path: string): number => {
    const index = num(value, path);
    if (index < 0 || index >= colors.length) {
      fail(path, `index ${index} is outside the palette`);
    }
    return index;
  };
  inPalette(style.outlineIndex, "dream.style.outlineIndex");
  inPalette(style.groundIndex, "dream.style.groundIndex");
  inPalette(style.accentIndex, "dream.style.accentIndex");
  const ramps = obj(style.ramps, "dream.style.ramps");
  if (Object.keys(ramps).length === 0) {
    fail("dream.style.ramps", "a style needs at least one shading ramp");
  }
  for (const [name, ramp] of Object.entries(ramps)) {
    arr(ramp, `dream.style.ramps.${name}`).forEach((entry, i) =>
      inPalette(entry, `dream.style.ramps.${name}[${i}]`),
    );
  }

  // --- rooms, first pass: shape, and the index the second pass needs
  const rooms = arr(root.rooms, "dream.rooms");
  if (rooms.length === 0)
    fail("dream.rooms", "a dream needs at least one room");
  const index: RoomIndex = {
    entryIds: new Map(),
    slotIds: new Map(),
    kinds: new Map(),
    levels: new Map(),
    buildings: new Map(),
  };
  const shaped = rooms.map((value, i) => {
    const room = validateRoomShape(value, `dream.rooms[${i}]`);
    const id = room.id as string;
    if (index.entryIds.has(id))
      fail(`dream.rooms[${i}].id`, `duplicate room id ${id}`);
    index.entryIds.set(
      id,
      new Set((room.entries as { id: string }[]).map((entry) => entry.id)),
    );
    index.slotIds.set(
      id,
      new Set((room.figureSlots as { id: string }[]).map((slot) => slot.id)),
    );
    index.kinds.set(id, room.kind as string);
    index.levels.set(id, room.level as number);
    index.buildings.set(id, (room.buildingId as string | null) ?? null);
    return room;
  });
  const roomIds = new Set(index.entryIds.keys());

  // --- shards and figures. Figures are needed before links, since a link may aim at one.
  const shardIds = new Set<string>();
  arr(root.shards, "dream.shards").forEach((s, i) => {
    const shard = obj(s, `dream.shards[${i}]`);
    shardIds.add(str(shard.id, `dream.shards[${i}].id`));
    str(shard.hint, `dream.shards[${i}].hint`);
  });

  const figureIds = new Set<string>();
  arr(root.figures, "dream.figures").forEach((f, i) => {
    const figure = obj(f, `dream.figures[${i}]`);
    const figureId = str(figure.id, `dream.figures[${i}].id`);
    if (figureIds.has(figureId))
      fail(`dream.figures[${i}].id`, `duplicate figure id ${figureId}`);
    figureIds.add(figureId);
    str(figure.name, `dream.figures[${i}].name`);
    str(figure.archetypeId, `dream.figures[${i}].archetypeId`);
    const roomId = str(figure.roomId, `dream.figures[${i}].roomId`);
    if (!roomIds.has(roomId))
      fail(`dream.figures[${i}].roomId`, `no room ${roomId}`);
    if (index.kinds.get(roomId) === "meta") {
      fail(
        `dream.figures[${i}].roomId`,
        `${roomId} is a meta-space — «разговаривать не с кем»`,
      );
    }
    const slotId = str(figure.slotId, `dream.figures[${i}].slotId`);
    if (!index.slotIds.get(roomId)?.has(slotId)) {
      fail(
        `dream.figures[${i}].slotId`,
        `room ${roomId} has no slot ${slotId}`,
      );
    }
    const holds = figure.holdsShardId;
    if (holds !== null && holds !== undefined && !shardIds.has(String(holds))) {
      fail(`dream.figures[${i}].holdsShardId`, `no shard ${String(holds)}`);
    }
  });

  // --- rooms, second pass: everything that points at another room
  //
  // Door ids are checked for uniqueness across the *whole* dream here, not just within a
  // room. `buildDoorIndexes` flattens every door into one map and every patch addresses a
  // door by bare id, so two rooms owning a `groby` would silently share a door.
  const allDoorIds = new Set<string>();
  const riftTargets = new Set<string>();
  const doorTargets = new Set<string>();
  shaped.forEach((room, i) => {
    const path = `dream.rooms[${i}]`;
    (room.doors as unknown[]).forEach((value, j) => {
      const door = value as {
        id: string;
        toRoomId: string;
        toEntryId: string | null;
        toFigureId: string | null;
        threshold: string;
        levelDelta: number;
      };
      if (allDoorIds.has(door.id)) {
        fail(
          `${path}.doors[${j}].id`,
          `door ${door.id} exists in another room`,
        );
      }
      allDoorIds.add(door.id);

      const entries = index.entryIds.get(door.toRoomId);
      if (!entries)
        fail(`${path}.doors[${j}].toRoomId`, `no room ${door.toRoomId}`);
      if (door.toEntryId !== null && !entries.has(door.toEntryId)) {
        fail(
          `${path}.doors[${j}].toEntryId`,
          `room ${door.toRoomId} has no entry ${door.toEntryId}`,
        );
      }
      if (door.toFigureId !== null && !figureIds.has(door.toFigureId)) {
        fail(`${path}.doors[${j}].toFigureId`, `no figure ${door.toFigureId}`);
      }

      if (door.threshold === "rift") riftTargets.add(door.toRoomId);
      doorTargets.add(door.toRoomId);

      // Only a staircase is held to the geometry. A lift that goes up and arrives lower
      // is §07's joke — «Лифт → всегда на этаж выше, до Отеля» — and a rift is illogical
      // by definition; those are the two thresholds allowed to lie about where they go.
      if (door.threshold === "stair") {
        const from = index.levels.get(room.id as string) ?? 0;
        const to = index.levels.get(door.toRoomId);
        if (
          index.buildings.get(room.id as string) !==
          index.buildings.get(door.toRoomId)
        ) {
          fail(
            `${path}.doors[${j}].toRoomId`,
            "a staircase stays inside its own building",
          );
        }
        if (to !== from + door.levelDelta) {
          fail(
            `${path}.doors[${j}].toRoomId`,
            `stair claims floor ${from + door.levelDelta}, ${door.toRoomId} is floor ${String(to)}`,
          );
        }
      }
      if (
        (door.threshold === "stair" || door.threshold === "lift") &&
        index.kinds.get(door.toRoomId) === "meta"
      ) {
        fail(
          `${path}.doors[${j}].toRoomId`,
          "nobody takes the stairs to a place they will not remember",
        );
      }
    });
  });

  // A meta-space used to be reachable only by rift. It now sits on the street map,
  // so any inbound door is enough — a rift still counts, for older artifacts.
  for (const [roomId, kind] of index.kinds) {
    if (
      kind === "meta" &&
      !doorTargets.has(roomId) &&
      !riftTargets.has(roomId)
    ) {
      fail(`dream.rooms.${roomId}`, "nothing leads into this meta-space");
    }
  }

  // --- spawn and finale
  const spawn = obj(root.spawn, "dream.spawn");
  const spawnRoom = str(spawn.roomId, "dream.spawn.roomId");
  const spawnEntries = index.entryIds.get(spawnRoom);
  if (!spawnEntries) fail("dream.spawn.roomId", `no room ${spawnRoom}`);
  const spawnEntry = str(spawn.entryId, "dream.spawn.entryId");
  if (!spawnEntries.has(spawnEntry)) {
    fail("dream.spawn.entryId", `room ${spawnRoom} has no entry ${spawnEntry}`);
  }
  const finaleRoomId = str(root.finaleRoomId, "dream.finaleRoomId");
  if (!roomIds.has(finaleRoomId)) {
    fail("dream.finaleRoomId", `no room ${finaleRoomId}`);
  }

  // --- authored personalities and the public mnemonic half
  const content = obj(root.content, "dream.content");
  const mnemonic = obj(content.mnemonic, "dream.content.mnemonic");
  const mnemonicHash = str(mnemonic.hash, "dream.content.mnemonic.hash");
  if (!/^[0-9a-f]{64}$/i.test(mnemonicHash)) {
    fail("dream.content.mnemonic.hash", "expected a SHA-256 hex digest");
  }
  if (str(mnemonic.wordlist, "dream.content.mnemonic.wordlist") !== "english") {
    fail(
      "dream.content.mnemonic.wordlist",
      "MVP supports the English BIP39 list",
    );
  }
  const knownSlots = arr(
    mnemonic.knownSlots,
    "dream.content.mnemonic.knownSlots",
  );
  if (knownSlots.length !== 12)
    fail("dream.content.mnemonic.knownSlots", "expected exactly 12 slots");
  let hiddenSlots = 0;
  knownSlots.forEach((slot, i) => {
    if (slot === null) hiddenSlots++;
    else str(slot, `dream.content.mnemonic.knownSlots[${i}]`);
  });
  if (hiddenSlots !== 6)
    fail(
      "dream.content.mnemonic.knownSlots",
      "expected exactly six hidden slots",
    );

  const characterIds = new Set<string>();
  arr(content.characters, "dream.content.characters").forEach((entry, i) => {
    const character = obj(entry, `dream.content.characters[${i}]`);
    const id = str(character.id, `dream.content.characters[${i}].id`);
    if (characterIds.has(id))
      fail(`dream.content.characters[${i}].id`, `duplicate character ${id}`);
    characterIds.add(id);
    if (!figureIds.has(id))
      fail(`dream.content.characters[${i}].id`, `no figure placement ${id}`);
    for (const field of [
      "name",
      "archetypeId",
      "personality",
      "role",
      "voice",
      "desire",
      "fear",
      "taboo",
      "initialActivity",
    ] as const) {
      str(character[field], `dream.content.characters[${i}].${field}`);
    }
    const portraits = obj(
      character.portraits,
      `dream.content.characters[${i}].portraits`,
    );
    for (const state of ["neutral", "interested", "wary", "knows"] as const) {
      str(
        portraits[state],
        `dream.content.characters[${i}].portraits.${state}`,
      );
    }
    // Loose 128x128 PNGs, when the art has been generated. The atlas frames above stay
    // required as the fallback, so a half-arted dream still draws something.
    if (
      character.portraitImages !== null &&
      character.portraitImages !== undefined
    ) {
      const images = obj(
        character.portraitImages,
        `dream.content.characters[${i}].portraitImages`,
      );
      for (const state of ["neutral", "interested", "wary", "knows"] as const) {
        optionalStr(
          images[state],
          `dream.content.characters[${i}].portraitImages.${state}`,
        );
      }
    }
    if (character.spriteSheet !== null && character.spriteSheet !== undefined) {
      const sheet = obj(
        character.spriteSheet,
        `dream.content.characters[${i}].spriteSheet`,
      );
      str(sheet.path, `dream.content.characters[${i}].spriteSheet.path`);
      num(sheet.frameW, `dream.content.characters[${i}].spriteSheet.frameW`);
      num(sheet.frameH, `dream.content.characters[${i}].spriteSheet.frameH`);
      num(sheet.frames, `dream.content.characters[${i}].spriteSheet.frames`);
      num(sheet.anchorY, `dream.content.characters[${i}].spriteSheet.anchorY`);
      arr(
        sheet.dirs,
        `dream.content.characters[${i}].spriteSheet.dirs`,
      ).forEach((dir, j) =>
        str(dir, `dream.content.characters[${i}].spriteSheet.dirs[${j}]`),
      );
    }
  });
  if (characterIds.size !== figureIds.size) {
    fail(
      "dream.content.characters",
      "every figure placement needs one character definition",
    );
  }

  const clueIds = new Set<string>();
  arr(content.clues, "dream.content.clues").forEach((entry, i) => {
    const clue = obj(entry, `dream.content.clues[${i}]`);
    const id = str(clue.id, `dream.content.clues[${i}].id`);
    if (clueIds.has(id))
      fail(`dream.content.clues[${i}].id`, `duplicate clue ${id}`);
    clueIds.add(id);
    for (const field of [
      "sensorySeed",
      "worldFrame",
      "detailFrame",
      "marker",
    ] as const) {
      str(clue[field], `dream.content.clues[${i}].${field}`);
    }
    for (const field of ["worldImage", "detailImage"] as const) {
      optionalStr(clue[field], `dream.content.clues[${i}].${field}`);
    }
    arr(clue.placementTags, `dream.content.clues[${i}].placementTags`).forEach(
      (tag, j) => str(tag, `dream.content.clues[${i}].placementTags[${j}]`),
    );
  });
  if (clueIds.size !== 6)
    fail("dream.content.clues", "the MVP requires exactly six clue objects");

  // Every clue hotspot must name a clue that exists, or a word sits somewhere unreachable.
  shaped.forEach((room, i) => {
    (room.hotspots as { kind: string; clueId: string | null }[]).forEach(
      (hotspot, j) => {
        if (hotspot.kind !== "clue") return;
        if (hotspot.clueId === null || !clueIds.has(hotspot.clueId)) {
          fail(
            `dream.rooms[${i}].hotspots[${j}].clueId`,
            `no clue ${String(hotspot.clueId)}`,
          );
        }
      },
    );
  });

  // --- timings
  const cycle = obj(root.cycle, "dream.cycle");
  if (num(cycle.durationMs, "dream.cycle.durationMs") <= 0) {
    fail("dream.cycle.durationMs", "must be positive");
  }
  if (cycle.maxCycles !== null && cycle.maxCycles !== undefined) {
    if (num(cycle.maxCycles, "dream.cycle.maxCycles") < 1) {
      fail("dream.cycle.maxCycles", "must be at least one cycle");
    }
  }
  const heartbeat = obj(root.heartbeat, "dream.heartbeat");
  if (num(heartbeat.intervalMs, "dream.heartbeat.intervalMs") < 1000) {
    fail(
      "dream.heartbeat.intervalMs",
      "a beat faster than a second is not a dream, it is a strobe",
    );
  }
  num(heartbeat.callBudgetPerCycle, "dream.heartbeat.callBudgetPerCycle");
  num(heartbeat.maxPatchesPerBeat, "dream.heartbeat.maxPatchesPerBeat");

  return root as unknown as DreamArtifact;
}

export function validateAtlasManifest(value: unknown): AtlasManifest {
  const root = obj(value, "atlas");
  if (num(root.format, "atlas.format") !== DREAM_FORMAT_VERSION) {
    fail("atlas.format", `expected format ${DREAM_FORMAT_VERSION}`);
  }
  str(root.image, "atlas.image");
  num(root.tileSize, "atlas.tileSize");
  const frames = obj(root.frames, "atlas.frames");
  const roleFrames = obj(root.roleFrames, "atlas.roleFrames");
  for (const [role, names] of Object.entries(roleFrames)) {
    const list = arr(names, `atlas.roleFrames.${role}`);
    if (list.length === 0)
      fail(`atlas.roleFrames.${role}`, "role has no frames");
    list.forEach((n, i) => {
      const name = str(n, `atlas.roleFrames.${role}[${i}]`);
      if (!(name in frames))
        fail(`atlas.roleFrames.${role}[${i}]`, `no frame named ${name}`);
    });
  }
  return root as unknown as AtlasManifest;
}

/** Re-exported so consumers get the room vocabulary from the artifact contract. */
export type { DreamRoom, DreamSpawn };
