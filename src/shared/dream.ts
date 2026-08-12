/**
 * The dream artifact: everything the Lord authored, and the only thing the player loads.
 *
 * §8 of the concept — one server, one dream, one secret, one playthrough. This file is
 * the contract between the two programs. The `lord` CLI is the only writer; the web
 * player is a pure reader. Nothing here is generated at runtime.
 *
 * The artifact describes the dream's *starting state*. Once play begins the heartbeat
 * mutates a live copy of it (§6, "дальше карта плывёт"); the artifact on disk never changes.
 */

import type { StyleProfile } from "./art/style";
import type { DoorTypeName } from "./tilecodes";

export const DREAM_FORMAT_VERSION = 2;

// ---------------------------------------------------------------------------
// Mission graph — Dormans' abstract structure, kept alongside the space it became
// ---------------------------------------------------------------------------

/**
 * Node kinds from GraphDungeonGenerator, read in dream fiction:
 *   key    — leverage a figure holds
 *   lock   — a threshold the dream refuses you
 *   puzzle — something the world itself will only give up to poking (§3's safe channel)
 *   lever  — a way round that the sleeper forgot to close
 */
export const NodeType = {
  START: "start",
  END: "end",
  NORMAL: "normal",
  KEY: "key",
  LOCK: "lock",
  PUZZLE: "puzzle",
  LEVER: "lever",
} as const;

export type NodeTypeName = (typeof NodeType)[keyof typeof NodeType];

export interface MissionNode {
  id: string;
  type: NodeTypeName;
  /** How many locks or puzzles stand between the start and here. Drives lever placement. */
  accessLevel: number;
  /** For KEY nodes: the id of the lock this opens. */
  opensLockId: string | null;
  /** For LOCK nodes: the id of the key that opens it. */
  requiresKeyId: string | null;
}

export interface MissionEdge {
  id: string;
  from: string;
  to: string;
  door: DoorTypeName;
  /** For keyLock doors, which key id passes. */
  keyId: string | null;
}

export interface MissionGraph {
  nodes: MissionNode[];
  edges: MissionEdge[];
  startId: string;
  endId: string;
}

// ---------------------------------------------------------------------------
// Space
// ---------------------------------------------------------------------------

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A place in the world.
 *
 * Still called a room because that is what it is to everything downstream — an area with
 * an id that the heartbeat can rearrange and the journal can name. Outdoors it is a town
 * or a field rather than four walls, which `region` says and `kind` does not: `kind`
 * distinguishes a *mission node's* place from the route between two of them, and plenty of
 * code depends on that distinction (figures do not stand in routes; routes have nothing to
 * rearrange).
 */
export interface Room {
  /** Matches the mission node id for `room` kind; synthesised for connectors. */
  id: string;
  kind: "room" | "connector";
  nodeType: NodeTypeName | null;
  /** town, wild, landmark, interior — what this place is for. See `worldgen/regions.ts`. */
  region: string;
  /** Which terrain palette this place is filled from. */
  biome: string;
  accessLevel: number;
  /** Shown in the HUD. The Lord may overwrite these by hand in dream.json. */
  name: string;
  /** Tile coordinates, walls included. */
  rect: Rect;
  /** Position on the layout cell grid, kept so the heartbeat can reason spatially. */
  cell: { cx: number; cy: number };
}

/**
 * A door you walk into that puts you somewhere else on the same grid.
 *
 * Interiors live in a reserved band of the one tile grid rather than in separate maps.
 * That keeps `DreamMap` a single array — so the validator, the room index, the patch
 * system and the minimap all carry on working unchanged — while still giving the world
 * buildings you can go inside, which is most of what makes a town read as a town.
 */
export interface Warp {
  id: string;
  /** Tile you step on. */
  x: number;
  y: number;
  /** Where you come out. */
  toX: number;
  toY: number;
  /** Region on the far side, for the HUD and the camera. */
  toRoomId: string;
}

export interface Door {
  id: string;
  type: DoorTypeName;
  /** Tile coordinates of the door tile itself. */
  x: number;
  y: number;
  /** 'v' means the door sits in a vertical wall and you pass through it horizontally. */
  orientation: "h" | "v";
  fromRoomId: string;
  toRoomId: string;
  keyId: string | null;
  /** Mission edge this door realises, so patches can keep graph and space in step. */
  edgeId: string;
}

export interface DreamMap {
  tileSize: number;
  /** Grid dimensions in tiles. */
  width: number;
  height: number;
  /** Base64 of a Uint8Array of length width*height. See `decodeTiles`. */
  tiles: string;
  rooms: Room[];
  doors: Door[];
  warps: Warp[];
  graph: MissionGraph;
  /** Where the sanitar arrives, in tile coordinates. */
  spawn: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Content the Lord authors by hand
// ---------------------------------------------------------------------------

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

export interface FigurePlacement {
  id: string;
  archetypeId: string;
  name: string;
  roomId: string;
  /** Tile coordinates. */
  x: number;
  y: number;
  holdsShardId: string | null;
}

export interface CycleConfig {
  /** How long before the patient surfaces and the dream restarts (§5). */
  durationMs: number;
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
 * §7.1 wants twelve to sixteen, and sixteen stays the default. The ceiling is higher only
 * because an outdoor world has more materials to name than a corridor does — grass, water,
 * cliff, tree, sand, roof — and a Lord who runs out of colours will otherwise reuse one and
 * make two materials indistinguishable, which is worse than a slightly wider palette.
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
   * usually read off the Lord's reference image. It ships because the *player* needs it:
   * a tile minted at runtime has to obey the same rules as one the Lord baked, or the
   * sleeper's inventions arrive looking like they came from somewhere else.
   */
  style: StyleProfile;
  map: DreamMap;
  figures: FigurePlacement[];
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
// Tile payload codec
// ---------------------------------------------------------------------------

/**
 * Tiles ride in dream.json as base64 rather than a JSON array: a 120x90 map is
 * ~11k tiles, which as numbers would dominate the file and make every other field
 * unreadable in a diff. base64 keeps the artifact a text file you can still inspect.
 */
export function encodeTiles(tiles: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < tiles.length; i += chunk) {
    binary += String.fromCharCode(...tiles.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function decodeTiles(
  encoded: string,
  expectedLength: number,
): Uint8Array {
  const binary = atob(encoded);
  if (binary.length !== expectedLength) {
    throw new Error(
      `tile payload is ${binary.length} bytes, expected ${expectedLength} (width * height)`,
    );
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Hand-written rather than schema-driven, because the useful errors here are
 * relational — a door pointing at a room that does not exist, a lock whose key sits
 * behind it — and those read better as prose than as a schema violation path.
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

  // --- map
  const map = obj(root.map, "dream.map");
  const width = num(map.width, "dream.map.width");
  const height = num(map.height, "dream.map.height");
  num(map.tileSize, "dream.map.tileSize");
  const tiles = decodeTiles(str(map.tiles, "dream.map.tiles"), width * height);

  const spawn = obj(map.spawn, "dream.map.spawn");
  const sx = num(spawn.x, "dream.map.spawn.x");
  const sy = num(spawn.y, "dream.map.spawn.y");
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) {
    fail(
      "dream.map.spawn",
      `spawn (${sx}, ${sy}) is outside the ${width}x${height} grid`,
    );
  }

  const rooms = arr(map.rooms, "dream.map.rooms") as unknown[];
  const roomIds = new Set<string>();
  rooms.forEach((r, i) => {
    const room = obj(r, `dream.map.rooms[${i}]`);
    const id = str(room.id, `dream.map.rooms[${i}].id`);
    if (roomIds.has(id))
      fail(`dream.map.rooms[${i}].id`, `duplicate room id ${id}`);
    roomIds.add(id);
    obj(room.rect, `dream.map.rooms[${i}].rect`);
  });
  if (rooms.length === 0)
    fail("dream.map.rooms", "a dream needs at least one room");

  const graph = obj(map.graph, "dream.map.graph");
  const nodes = arr(graph.nodes, "dream.map.graph.nodes") as unknown[];
  const nodeById = new Map<string, MissionNode>();
  nodes.forEach((n, i) => {
    const node = obj(
      n,
      `dream.map.graph.nodes[${i}]`,
    ) as unknown as MissionNode;
    nodeById.set(str(node.id, `dream.map.graph.nodes[${i}].id`), node);
  });
  const startId = str(graph.startId, "dream.map.graph.startId");
  const endId = str(graph.endId, "dream.map.graph.endId");
  if (!nodeById.has(startId))
    fail("dream.map.graph.startId", `no node ${startId}`);
  if (!nodeById.has(endId)) fail("dream.map.graph.endId", `no node ${endId}`);

  arr(graph.edges, "dream.map.graph.edges").forEach((e, i) => {
    const edge = obj(e, `dream.map.graph.edges[${i}]`);
    const from = str(edge.from, `dream.map.graph.edges[${i}].from`);
    const to = str(edge.to, `dream.map.graph.edges[${i}].to`);
    if (!nodeById.has(from))
      fail(`dream.map.graph.edges[${i}].from`, `no node ${from}`);
    if (!nodeById.has(to))
      fail(`dream.map.graph.edges[${i}].to`, `no node ${to}`);
  });

  // A lock you can only open with a key that sits behind it is a dead dream. The
  // generator will not produce one, but a Lord editing dream.json by hand might.
  for (const node of nodeById.values()) {
    if (node.type !== NodeType.LOCK || !node.requiresKeyId) continue;
    const key = [...nodeById.values()].find((n) => n.opensLockId === node.id);
    if (!key) fail(`dream.map.graph`, `lock ${node.id} has no key node`);
    if (key.accessLevel >= node.accessLevel) {
      fail(
        `dream.map.graph`,
        `key ${key.id} (access ${key.accessLevel}) is not reachable before lock ${node.id} (access ${node.accessLevel})`,
      );
    }
  }

  arr(map.warps, "dream.map.warps").forEach((w, i) => {
    const warp = obj(w, `dream.map.warps[${i}]`);
    const toRoomId = str(warp.toRoomId, `dream.map.warps[${i}].toRoomId`);
    if (!roomIds.has(toRoomId))
      fail(`dream.map.warps[${i}].toRoomId`, `no room ${toRoomId}`);
    for (const axis of ["x", "y", "toX", "toY"] as const) {
      const value = num(warp[axis], `dream.map.warps[${i}].${axis}`);
      const limit = axis === "x" || axis === "toX" ? width : height;
      if (value < 0 || value >= limit) {
        fail(`dream.map.warps[${i}].${axis}`, `${value} is outside the grid`);
      }
    }
  });

  arr(map.doors, "dream.map.doors").forEach((d, i) => {
    const door = obj(d, `dream.map.doors[${i}]`);
    const from = str(door.fromRoomId, `dream.map.doors[${i}].fromRoomId`);
    const to = str(door.toRoomId, `dream.map.doors[${i}].toRoomId`);
    if (!roomIds.has(from))
      fail(`dream.map.doors[${i}].fromRoomId`, `no room ${from}`);
    if (!roomIds.has(to))
      fail(`dream.map.doors[${i}].toRoomId`, `no room ${to}`);
    const dx = num(door.x, `dream.map.doors[${i}].x`);
    const dy = num(door.y, `dream.map.doors[${i}].y`);
    if (dx < 0 || dy < 0 || dx >= width || dy >= height) {
      fail(
        `dream.map.doors[${i}]`,
        `door at (${dx}, ${dy}) is outside the grid`,
      );
    }
  });

  // --- shards and figures
  const shardIds = new Set<string>();
  arr(root.shards, "dream.shards").forEach((s, i) => {
    const shard = obj(s, `dream.shards[${i}]`);
    shardIds.add(str(shard.id, `dream.shards[${i}].id`));
    str(shard.hint, `dream.shards[${i}].hint`);
  });

  arr(root.figures, "dream.figures").forEach((f, i) => {
    const figure = obj(f, `dream.figures[${i}]`);
    str(figure.id, `dream.figures[${i}].id`);
    const roomId = str(figure.roomId, `dream.figures[${i}].roomId`);
    if (!roomIds.has(roomId))
      fail(`dream.figures[${i}].roomId`, `no room ${roomId}`);
    const holds = figure.holdsShardId;
    if (holds !== null && holds !== undefined && !shardIds.has(String(holds))) {
      fail(`dream.figures[${i}].holdsShardId`, `no shard ${String(holds)}`);
    }
  });

  // --- timings
  const cycle = obj(root.cycle, "dream.cycle");
  if (num(cycle.durationMs, "dream.cycle.durationMs") <= 0) {
    fail("dream.cycle.durationMs", "must be positive");
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

  void tiles; // decoded above purely to validate length
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
