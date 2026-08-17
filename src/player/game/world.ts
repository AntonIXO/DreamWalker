/**
 * The live dream.
 *
 * The artifact on disk is the dream's *starting* state and never changes. This is the
 * copy that does: the heartbeat rewrites it while the player is standing in it (§6,
 * "дальше карта плывёт"). Keeping the two apart is what makes a cycle reset trivial —
 * throw the live copy away and rebuild it from the same artifact.
 *
 * Only `game/patch.ts` is allowed to write to rooms. Everything else reads.
 *
 * Format 4 made this much smaller. There is no tile array, no room index, no door tile
 * map and no chamber assignment, because a room is now a discrete authored scene rather
 * than a rectangle cut out of one shared grid. What survives is the part that was always
 * about *state* rather than geometry: who is where, what the sanitar is carrying, what
 * the sleeper has shut, and how many times you have been somewhere.
 */

import type { DreamArtifact, FigurePlacement } from "../../shared/dream";
import type { DreamRoom, RoomDoor, RoomHotspot } from "../../shared/room";
import type { Direction } from "../../shared/roomGrid";
import type { DoorTypeName } from "../../shared/tilecodes";
import type {
  AgendaPhase,
  DreamPopulation,
  FigureAgenda,
  InterestSeed,
} from "../../shared/ai";
import type { PortraitState } from "../../shared/content";
import { applyFateLedger, type FateRecord } from "./fates";
import { clampExhaustion } from "./exhaustion";
import type { ScriptFlag } from "../../shared/pack";

export interface FigureState extends FigurePlacement {
  facing: Direction;
  /** Tile coordinates, fractional. Seeded from the slot, then walked. */
  x: number;
  y: number;
  /** Bumped when the heartbeat moves them, so the view knows to re-place the sprite. */
  revision: number;
  personality: string;
  portraitState: PortraitState;
  role: string;
  voice: string;
  desire: string;
  fear: string;
  taboo: string;
  agenda: FigureAgenda[];
  activity: string;
  agendaPhase: AgendaPhase;
  targetX: number | null;
  targetY: number | null;
  walkWait: number;
  walkTime: number;
  walking: boolean;
}

/**
 * Something the sleeper put in a room for the sanitar to find.
 *
 * In format 3 an interest wrote a prop tile into the grid and remembered what it had
 * covered. It is a hotspot now, so there is nothing to cover and nothing to restore.
 */
export interface InterestState extends InterestSeed {
  roomId: string;
  /**
   * Which authored slot it claimed, so the next arrival does not claim the same one.
   * Null when nothing was free and it fell back to loose floor.
   */
  slotId: string | null;
  /** Tile coordinates, fractional. */
  x: number;
  y: number;
}

/** A room as it currently stands, which is not always as it was authored. */
export interface RoomState extends DreamRoom {
  /** Which `cellVariants` entry is live, or null for the authored mask. */
  activeVariant: string | null;
  /** Hotspots the sleeper has taken away, or that have already fired their `once`. */
  closedHotspotIds: Set<string>;
}

export interface WorldState {
  readonly artifact: DreamArtifact;

  readonly rooms: RoomState[];
  readonly roomById: Map<string, RoomState>;
  /** Where the sanitar is. Replaces format 3's "which rect am I inside". */
  currentRoomId: string;

  /** Every door in the dream, indexed across rooms so a patch can name one. */
  doorById: Map<string, RoomDoor>;
  /** Which room each door lives in, so a patch knows what it touched. */
  roomIdByDoorId: Map<string, string>;

  figures: FigureState[];
  interests: InterestState[];
  population: DreamPopulation | null;
  baseFigures: FigureState[];
  baseInterests: InterestState[];

  /** What the sanitar has got hold of. Doors consult these. */
  keysHeld: Set<string>;
  leversPulled: Set<string>;
  puzzlesSolved: Set<string>;

  /** Rooms the player has stood in this cycle. Feeds observation and the journal. */
  visited: Set<string>;

  /**
   * How many times the sanitar has entered each room, **across cycles**.
   *
   * §4.3 — «второй визит хуже первого». The canonical case is §06: the same ditch, the
   * same garages, except this time there are two of them, and next time four. It is
   * deliberately not cleared by `resetWorld`: the dream repeats, and the sanitar is the
   * one thing in it that remembers.
   */
  visitCounts: Map<string, number>;

  /**
   * Doors the sleeper has shut this cycle, and what they were before. `openDoor` may
   * only restore something listed here, which is how §6's "never a cheaper path" is
   * enforced rather than merely intended.
   */
  sealHistory: Map<string, DoorTypeName>;

  /**
   * What the sanitar has done to people, and what he holds over them.
   *
   * All three are **deliberately not cleared by `resetWorld`**, for the same reason
   * `visitCounts` is not: the dream forgets the conversation, the sanitar does not.
   * `fates` is the current standing, `fateHistory` is append-only and is what the Eye
   * reads («Помнит, кого санитар убил и сколько раз»), and `leverage` is what one figure
   * let slip about another. See `game/fates.ts`.
   */
  fates: Map<string, FateRecord>;
  fateHistory: FateRecord[];
  leverage: Map<string, Set<string>>;

  /**
   * How spent the sanitar is, 0..1. Survives a cycle: the dream forgets, the
   * body does not.
   */
  exhaustion: number;
  /** Pack-script state. Cleared only where a script says so. */
  flags: Map<string, ScriptFlag>;
}

function cloneRoom(room: DreamRoom): RoomState {
  return {
    ...room,
    cells: [...room.cells],
    cellVariants: Object.fromEntries(
      Object.entries(room.cellVariants).map(([name, rows]) => [
        name,
        [...rows],
      ]),
    ),
    props: room.props.map((prop) => ({ ...prop })),
    hotspots: room.hotspots.map((hotspot) => ({ ...hotspot })),
    entries: room.entries.map((entry) => ({ ...entry })),
    doors: room.doors.map((door) => ({ ...door })),
    figureSlots: room.figureSlots.map((slot) => ({ ...slot })),
    graphics: { ...room.graphics },
    revisit: { ...room.revisit },
    meta: room.meta ? { ...room.meta } : null,
    tags: [...room.tags],
    copy: { ...room.copy },
    activeVariant: null,
    closedHotspotIds: new Set(),
  };
}

export function buildDoorIndexes(rooms: readonly RoomState[]): {
  doorById: Map<string, RoomDoor>;
  roomIdByDoorId: Map<string, string>;
} {
  const doorById = new Map<string, RoomDoor>();
  const roomIdByDoorId = new Map<string, string>();
  for (const room of rooms) {
    for (const door of room.doors) {
      doorById.set(door.id, door);
      roomIdByDoorId.set(door.id, room.id);
    }
  }
  return { doorById, roomIdByDoorId };
}

export function createWorld(artifact: DreamArtifact): WorldState {
  const rooms = artifact.rooms.map(cloneRoom);
  const roomById = new Map(rooms.map((room) => [room.id, room]));
  const figures = artifact.figures.map((figure) =>
    makeFigureState(figure, roomById.get(figure.roomId)),
  );
  const { doorById, roomIdByDoorId } = buildDoorIndexes(rooms);

  return {
    artifact,
    rooms,
    roomById,
    currentRoomId: artifact.spawn.roomId,
    doorById,
    roomIdByDoorId,
    figures,
    interests: [],
    population: null,
    baseFigures: figures.map(cloneFigureState),
    baseInterests: [],
    keysHeld: new Set(),
    leversPulled: new Set(),
    puzzlesSolved: new Set(),
    visited: new Set(),
    visitCounts: new Map(),
    sealHistory: new Map(),
    fates: new Map(),
    fateHistory: [],
    leverage: new Map(),
    exhaustion: 0,
    flags: new Map(),
  };
}

function makeFigureState(
  figure: FigurePlacement,
  room: RoomState | undefined,
): FigureState {
  const slot = room?.figureSlots.find((entry) => entry.id === figure.slotId);
  return {
    ...figure,
    facing: "s",
    x: slot?.x ?? 1,
    y: slot?.y ?? 1,
    revision: 0,
    personality: "Держится за привычный порядок.",
    portraitState: "neutral",
    role: "часть этого сна",
    voice: "говорит просто и настороженно",
    desire: "сохранить привычный порядок",
    fear: "что день пойдёт не так",
    taboo: "не обсуждает то, что было до сна",
    agenda: [],
    activity: "стоит и прислушивается",
    agendaPhase: "early",
    targetX: null,
    targetY: null,
    walkWait: 1,
    walkTime: 0,
    walking: false,
  };
}

export function cloneFigureState(figure: FigureState): FigureState {
  return {
    ...figure,
    agenda: figure.agenda.map((stop) => ({ ...stop })),
    targetX: null,
    targetY: null,
    walking: false,
    walkTime: 0,
  };
}

/**
 * Put the dream back the way its Lord left it (§5).
 *
 * Done in place rather than by building a new world, so every long-lived reference —
 * the scene, the mind, the heartbeat, the debug overlay — stays valid across a cycle.
 * The installed population snapshot is the source of truth; nothing here has to undo
 * individual patches. Before population arrives that snapshot is simply the artifact.
 */
export function resetWorld(world: WorldState, cycle = 1): void {
  const authoredById = new Map(
    world.artifact.rooms.map((room) => [room.id, room]),
  );
  for (const room of world.rooms) {
    const authored = authoredById.get(room.id);
    if (!authored) continue;
    room.name = authored.name;
    room.cells = [...authored.cells];
    room.activeVariant = null;
    room.closedHotspotIds.clear();
    room.hotspots = authored.hotspots.map((hotspot) => ({ ...hotspot }));
    room.doors = authored.doors.map((door) => ({ ...door }));
  }
  const indexes = buildDoorIndexes(world.rooms);
  world.doorById = indexes.doorById;
  world.roomIdByDoorId = indexes.roomIdByDoorId;

  world.figures.length = 0;
  world.figures.push(...world.baseFigures.map(cloneFigureState));
  world.interests.length = 0;
  world.interests.push(
    ...world.baseInterests.map((interest) => ({ ...interest })),
  );
  // The rebuild above resurrects everybody. This puts back what was done to them.
  applyFateLedger(world, cycle);

  world.currentRoomId = world.artifact.spawn.roomId;

  // The live world and its figures forget. The journal, the sleeper's compact model and
  // `visitCounts` live outside a cycle and deliberately survive (§5, §4.3).
  world.keysHeld.clear();
  world.leversPulled.clear();
  world.puzzlesSolved.clear();
  world.visited.clear();
  world.sealHistory.clear();
}

export function currentRoom(world: WorldState): RoomState {
  const room = world.roomById.get(world.currentRoomId);
  if (!room) {
    throw new Error(
      `world is in room ${world.currentRoomId}, which does not exist`,
    );
  }
  return room;
}

export function roomOf(world: WorldState, roomId: string): RoomState | null {
  return world.roomById.get(roomId) ?? null;
}

/** How many times the sanitar has entered a room, counting this cycle and every earlier one. */
export function visitCount(world: WorldState, roomId: string): number {
  return world.visitCounts.get(roomId) ?? 0;
}

/** Records an arrival and returns the new count. */
export function addExhaustion(world: WorldState, delta: number): number {
  world.exhaustion = clampExhaustion(world.exhaustion + delta);
  return world.exhaustion;
}

export function worldFlag(
  world: WorldState,
  key: string,
): ScriptFlag | undefined {
  return world.flags.get(key);
}

export function setWorldFlag(
  world: WorldState,
  key: string,
  value: ScriptFlag,
): void {
  world.flags.set(key, value);
}

export function noteVisit(world: WorldState, roomId: string): number {
  const next = visitCount(world, roomId) + 1;
  world.visitCounts.set(roomId, next);
  world.visited.add(roomId);
  return next;
}

/** Hotspots that are actually there right now. */
export function liveHotspots(room: RoomState): RoomHotspot[] {
  if (room.closedHotspotIds.size === 0) return room.hotspots;
  return room.hotspots.filter(
    (hotspot) => !room.closedHotspotIds.has(hotspot.id),
  );
}

/** Interests the sleeper placed in this room, as hotspots the resolver can see. */
export function interestHotspots(
  world: WorldState,
  roomId: string,
): RoomHotspot[] {
  return world.interests
    .filter((interest) => interest.roomId === roomId)
    .map((interest) => ({
      id: `interest:${interest.id}`,
      kind: "look" as const,
      x: interest.x,
      y: interest.y,
      reach: 1.4,
      prompt: interest.name,
      refusal: null,
      clueId: interest.clueId,
      propId: null,
      action: null,
      once: false,
      dwellMs: null,
    }));
}

export function interestById(
  world: WorldState,
  id: string,
): InterestState | null {
  return world.interests.find((interest) => interest.id === id) ?? null;
}

export function doorById(world: WorldState, id: string): RoomDoor | null {
  return world.doorById.get(id) ?? null;
}

/**
 * Whether the sanitar may pass a door *right now*. Deliberately not a property of the
 * geometry: it depends on what you are carrying, and a rect does not know that.
 */
export function canPassDoor(world: WorldState, door: RoomDoor): boolean {
  switch (door.type) {
    case "open":
      return true;
    case "sealed":
      return false;
    // A ledge never refuses. It is one-way, and which way is a question about the
    // direction of travel, which the walker answers, not the door.
    case "ledge":
      return true;
    case "keyLock":
      return door.keyId !== null && world.keysHeld.has(door.keyId);
    case "leverLock":
      return world.leversPulled.has(door.id);
    case "puzzleLock":
      return world.puzzlesSolved.has(door.id);
    default:
      return false;
  }
}

/** Reason a door will not open, phrased for the player rather than for a log. */
export function doorRefusal(door: RoomDoor): string {
  if (door.prompt) return door.prompt;
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

/** The door whose rect contains this tile, if any. */
export function doorAtTile(
  room: RoomState,
  tx: number,
  ty: number,
): RoomDoor | null {
  for (const door of room.doors) {
    if (
      tx >= door.x &&
      tx < door.x + door.w &&
      ty >= door.y &&
      ty < door.y + door.h
    ) {
      return door;
    }
  }
  return null;
}

/**
 * Where a threshold actually lands.
 *
 * Only a rift can be indirect, and only in one way: §13's «диванчик, на котором спит
 * Лёша» follows Лёша wherever the heartbeat moved him. Everything else is the door's own
 * `toRoomId` — a staircase that needed resolving would not be a staircase.
 */
export function doorDestination(
  world: WorldState,
  door: RoomDoor,
): { roomId: string; entryId: string | null } {
  if (door.toFigureId) {
    const figure = world.figures.find((f) => f.id === door.toFigureId);
    if (figure) return { roomId: figure.roomId, entryId: null };
  }
  return { roomId: door.toRoomId, entryId: door.toEntryId };
}
