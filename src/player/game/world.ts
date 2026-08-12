/**
 * The live dream.
 *
 * The artifact on disk is the dream's *starting* state and never changes. This is the
 * copy that does: the heartbeat rewrites it while the player is standing in it (§6,
 * "дальше карта плывёт"). Keeping the two apart is what makes a cycle reset trivial —
 * throw the live copy away and build another from the same artifact.
 *
 * Only `game/patch.ts` is allowed to write to `tiles`. Everything else reads.
 */

import {
  decodeTiles,
  type Door,
  type DreamArtifact,
  type FigurePlacement,
  type MissionNode,
  type Room,
  type Warp,
} from "../../shared/dream";
import { doorSpan } from "../../shared/doors";
import {
  Tile,
  doorTypeOfTile,
  isDoorTile,
  type DoorTypeName,
} from "../../shared/tilecodes";

export interface FigureState extends FigurePlacement {
  facing: "n" | "e" | "s" | "w";
  /** Bumped when the heartbeat moves them, so the view knows to re-place the sprite. */
  revision: number;
}

export interface WorldState {
  readonly artifact: DreamArtifact;
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  /** Mutable. The authored grid is in `artifact`; this one drifts. */
  tiles: Uint8Array;

  readonly rooms: Room[];
  readonly roomById: Map<string, Room>;
  /** tile index -> position in `rooms`, or -1 outside every cell. */
  readonly roomIndex: Int16Array;

  doors: Door[];
  /** "x,y" for every tile of a gate -> the gate. Rebuilt whenever doors move. */
  doorAt: Map<string, Door>;

  /** Doorways into buildings. Never patched — the sleeper rearranges country, not houses. */
  readonly warpAt: Map<string, Warp>;

  figures: FigureState[];

  /** What the sanitar has got hold of. Doors consult these. */
  keysHeld: Set<string>;
  leversPulled: Set<string>;
  puzzlesSolved: Set<string>;

  /** Rooms the player has stood in. Feeds the heartbeat's observation and the journal. */
  visited: Set<string>;

  /**
   * Doors the sleeper has shut this cycle, and what they were before. `openDoor` may
   * only restore something listed here, which is how §6's "never a cheaper path" is
   * enforced rather than merely intended.
   */
  sealHistory: Map<string, DoorTypeName>;
}

const key = (x: number, y: number): string => `${x},${y}`;

function indexRooms(rooms: Room[], width: number, height: number): Int16Array {
  const index = new Int16Array(width * height).fill(-1);
  rooms.forEach((room, i) => {
    for (let y = room.rect.y; y < room.rect.y + room.rect.h; y++) {
      for (let x = room.rect.x; x < room.rect.x + room.rect.w; x++) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        index[y * width + x] = i;
      }
    }
  });
  return index;
}

export function buildDoorIndex(doors: readonly Door[]): Map<string, Door> {
  const map = new Map<string, Door>();
  for (const door of doors) {
    for (const tile of doorSpan(door)) map.set(key(tile.x, tile.y), door);
  }
  return map;
}

/**
 * The tiles a gate covers.
 *
 * Re-exported from `shared/doors.ts` rather than reimplemented. It used to be a hand-kept
 * copy of the generator's version; they are now the same function, because the two were
 * never allowed to disagree and pretending otherwise only made the disagreement quiet.
 */
export { doorSpan as doorTiles } from "../../shared/doors";

export function createWorld(artifact: DreamArtifact): WorldState {
  const { map } = artifact;
  const rooms = map.rooms.map((room) => ({ ...room, rect: { ...room.rect } }));
  const doors = map.doors.map((door) => ({ ...door }));

  return {
    artifact,
    width: map.width,
    height: map.height,
    tileSize: map.tileSize,
    tiles: decodeTiles(map.tiles, map.width * map.height),
    rooms,
    roomById: new Map(rooms.map((room) => [room.id, room])),
    roomIndex: indexRooms(rooms, map.width, map.height),
    doors,
    doorAt: buildDoorIndex(doors),
    warpAt: new Map(map.warps.map((warp) => [key(warp.x, warp.y), warp])),
    figures: artifact.figures.map((figure) => ({
      ...figure,
      facing: "s",
      revision: 0,
    })),
    keysHeld: new Set(),
    leversPulled: new Set(),
    puzzlesSolved: new Set(),
    visited: new Set(),
    sealHistory: new Map(),
  };
}

/**
 * Put the dream back the way its Lord left it (§5).
 *
 * Done in place rather than by building a new world, so every long-lived reference —
 * the tilemap, the mind, the heartbeat, the debug overlay — stays valid across a cycle.
 * The artifact is the source of truth; nothing here has to undo anything.
 */
export function resetWorld(world: WorldState): void {
  const { map } = world.artifact;

  world.tiles = decodeTiles(map.tiles, map.width * map.height);

  world.doors.length = 0;
  world.doors.push(...map.doors.map((door) => ({ ...door })));
  world.doorAt = buildDoorIndex(world.doors);

  world.figures.length = 0;
  world.figures.push(
    ...world.artifact.figures.map((figure) => ({
      ...figure,
      facing: "s" as const,
      revision: 0,
    })),
  );

  // The live world and its figures forget. The journal and the sleeper's compact model
  // live outside WorldState and deliberately survive (§5).
  world.keysHeld.clear();
  world.leversPulled.clear();
  world.puzzlesSolved.clear();
  world.visited.clear();
  world.sealHistory.clear();
}

export function tileAt(world: WorldState, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return Tile.VOID;
  return world.tiles[y * world.width + x]!;
}

export function roomAt(world: WorldState, x: number, y: number): Room | null {
  if (x < 0 || y < 0 || x >= world.width || y >= world.height) return null;
  const index = world.roomIndex[y * world.width + x]!;
  return index >= 0 ? (world.rooms[index] ?? null) : null;
}

export function doorAtTile(
  world: WorldState,
  x: number,
  y: number,
): Door | null {
  return world.doorAt.get(key(x, y)) ?? null;
}

export function warpAtTile(
  world: WorldState,
  x: number,
  y: number,
): Warp | null {
  return world.warpAt.get(key(x, y)) ?? null;
}

/**
 * Whether the sanitar may pass a door *right now*. Deliberately not a property of the
 * tile: it depends on what you are carrying, and the grid does not know that.
 */
export function canPassDoor(world: WorldState, door: Door): boolean {
  switch (door.type) {
    case "open":
      return true;
    case "sealed":
      return false;
    // A ledge never refuses. It is one-way, and which way is a question about the
    // direction of travel, which `collision.ts` answers from the tile.
    case "ledge":
      return true;
    case "keyLock":
      return door.keyId !== null && world.keysHeld.has(door.keyId);
    case "leverLock":
      return world.leversPulled.has(door.edgeId);
    case "puzzleLock":
      return world.puzzlesSolved.has(door.edgeId);
    default:
      return false;
  }
}

/** Reason a door will not open, phrased for the player rather than for a log. */
export function doorRefusal(door: Door): string {
  switch (door.type) {
    case "keyLock":
      return "Заперто. Нужно то, чего у тебя нет.";
    case "leverLock":
      return "Не открывается с этой стороны.";
    case "puzzleLock":
      return "Дверь не считает тебя тем, кто может пройти.";
    case "sealed":
      return "Прохода больше нет. Он был здесь.";
    default:
      return "Не открывается.";
  }
}

export function missionNode(
  world: WorldState,
  id: string,
): MissionNode | undefined {
  return world.artifact.map.graph.nodes.find((node) => node.id === id);
}

/** Every door tile of the grid agrees with the door list. Used after patches. */
export function isDoorTileAt(world: WorldState, x: number, y: number): boolean {
  return isDoorTile(tileAt(world, x, y));
}

export function doorTypeAt(
  world: WorldState,
  x: number,
  y: number,
): string | null {
  return doorTypeOfTile(tileAt(world, x, y));
}
