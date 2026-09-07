/**
 * Temporary WorldMutator built from a WorldSnapshot.
 *
 * The live world is frozen during an NPC AI turn. Tools run here; the browser
 * later replays the successful envelopes through the same executeWorldAction.
 * Must stay free of DOM and node APIs.
 */

import type { WorldSnapshot, WorldSnapshotObject } from "./ai";
import type {
  WorldAction,
  WorldActionEnvelope,
  WorldActionResult,
  WorldEvent,
} from "./world-action";
import { MAX_WORLD_ACTIONS_PER_TURN } from "./world-action";
import { executeWorldAction, refused } from "./world-action-engine";
import type {
  ActorPose,
  ObjectLocation,
  WorldDoorView,
  WorldMutator,
  WorldObjectState,
} from "./world-object";
import { cloneObject } from "./world-object";

export type WorldActionExecutor = (
  world: WorldMutator,
  envelope: WorldActionEnvelope,
) => WorldActionResult;

export const NPC_WORLD_TOOL_NAMES = [
  "move_to",
  "take",
  "drop",
  "give",
  "put",
  "open",
  "close",
  "activate",
  "use",
  "traverse",
] as const;

export type NpcWorldToolName = (typeof NPC_WORLD_TOOL_NAMES)[number];

export const NPC_WORLD_TOOL_NAME_SET: ReadonlySet<string> = new Set(
  NPC_WORLD_TOOL_NAMES,
);

export interface NpcToolResult {
  ok: boolean;
  refusal: string | null;
  events: WorldEvent[];
  affectedObjects: string[];
  affectedRooms: string[];
  worldRevision: number;
}

export interface NpcWorldSession {
  readonly world: WorldMutator;
  readonly successful: WorldActionEnvelope[];
  runTool(name: string, input: unknown): NpcToolResult;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function objectFromSnapshot(raw: WorldSnapshotObject): WorldObjectState {
  return {
    id: raw.id,
    name: raw.name,
    location: { ...raw.location } as ObjectLocation,
    mobility: raw.mobility,
    affordances: [...raw.affordances],
    body: raw.body ? { ...raw.body } : null,
    visual: { role: null, image: null },
    interaction: null,
    state: { ...raw.state },
    tags: [...raw.tags],
    clueId: raw.clueId,
    holdsShardId: raw.holdsShardId,
    sensorySeed: null,
    once: false,
    dwellMs: null,
    keyId: raw.keyId,
    hotspotKind: null,
    uiAction: null,
  };
}

function snapshotObjectFromState(object: WorldObjectState): WorldSnapshotObject {
  return {
    id: object.id,
    name: object.name,
    location: { ...object.location } as ObjectLocation,
    mobility: object.mobility,
    affordances: [...object.affordances],
    state: { ...object.state },
    keyId: object.keyId,
    body: object.body ? { ...object.body } : null,
    clueId: object.clueId,
    holdsShardId: object.holdsShardId,
    tags: [...object.tags],
  };
}

function cloneDoor(door: WorldDoorView): WorldDoorView {
  return { ...door };
}

function clonePose(pose: ActorPose): ActorPose {
  return { roomId: pose.roomId, x: pose.x, y: pose.y };
}

function keysFromObjects(objects: WorldObjectState[]): Set<string> {
  const keys = new Set<string>();
  for (const object of objects) {
    if (object.location.kind === "held" && object.keyId) keys.add(object.keyId);
  }
  return keys;
}

/**
 * A WorldMutator that can clone itself. Figure poses and doors are stored
 * privately because the frozen mutator surface cannot enumerate them.
 */
export class SnapshotSandbox implements WorldMutator {
  revision: number;
  objects: WorldObjectState[];
  objectById: Map<string, WorldObjectState>;
  keysHeld: Set<string>;
  private player: ActorPose | null;
  private figures: Map<string, ActorPose>;
  private doors: Map<string, WorldDoorView>;

  constructor(init: {
    revision: number;
    objects: WorldObjectState[];
    player: ActorPose | null;
    figures: Map<string, ActorPose>;
    doors: Map<string, WorldDoorView>;
    keysHeld?: Set<string>;
  }) {
    this.revision = init.revision;
    this.objects = init.objects;
    this.objectById = new Map(init.objects.map((object) => [object.id, object]));
    this.player = init.player;
    this.figures = init.figures;
    this.doors = init.doors;
    this.keysHeld = init.keysHeld ?? keysFromObjects(init.objects);
  }

  static fromSnapshot(snapshot: WorldSnapshot): SnapshotSandbox {
    const objects = (snapshot.objects ?? []).map(objectFromSnapshot);
    const figures = new Map<string, ActorPose>();
    for (const figure of snapshot.figures) {
      figures.set(figure.id, {
        roomId: figure.roomId,
        x: figure.x ?? 0,
        y: figure.y ?? 0,
      });
    }
    const doors = new Map<string, WorldDoorView>();
    for (const door of snapshot.doors) {
      doors.set(door.id, {
        id: door.id,
        type: door.type,
        fromRoomId: door.fromRoomId,
        toRoomId: door.toRoomId,
        x: door.x ?? 0,
        y: door.y ?? 0,
        keyId: door.keyId ?? null,
        threshold: door.threshold ?? "door",
      });
    }
    const player = snapshot.player
      ? {
          roomId: snapshot.player.roomId,
          x: snapshot.player.x,
          y: snapshot.player.y,
        }
      : null;
    return new SnapshotSandbox({
      revision: snapshot.worldRevision ?? 0,
      objects,
      player,
      figures,
      doors,
    });
  }

  clone(): SnapshotSandbox {
    const objects = this.objects.map(cloneObject);
    const figures = new Map<string, ActorPose>();
    for (const [id, pose] of this.figures) figures.set(id, clonePose(pose));
    const doors = new Map<string, WorldDoorView>();
    for (const [id, door] of this.doors) doors.set(id, cloneDoor(door));
    return new SnapshotSandbox({
      revision: this.revision,
      objects,
      player: this.player ? clonePose(this.player) : null,
      figures,
      doors,
      keysHeld: new Set(this.keysHeld),
    });
  }

  toSnapshotExtras(): {
    objects: WorldSnapshotObject[];
    player: ActorPose | null;
    worldRevision: number;
  } {
    return {
      objects: this.objects.map(snapshotObjectFromState),
      player: this.player ? clonePose(this.player) : null,
      worldRevision: this.revision,
    };
  }

  objectLocations(): Array<{ id: string; location: ObjectLocation }> {
    return this.objects.map((object) => ({
      id: object.id,
      location: { ...object.location } as ObjectLocation,
    }));
  }

  getPlayerPose(): ActorPose | null {
    return this.player ? clonePose(this.player) : null;
  }

  setPlayerPose(pose: ActorPose): void {
    this.player = clonePose(pose);
  }

  getFigurePose(figureId: string): ActorPose | null {
    const pose = this.figures.get(figureId);
    return pose ? clonePose(pose) : null;
  }

  setFigurePose(figureId: string, pose: ActorPose): void {
    this.figures.set(figureId, clonePose(pose));
  }

  getDoor(doorId: string): WorldDoorView | null {
    const door = this.doors.get(doorId);
    return door ? cloneDoor(door) : null;
  }

  setDoorType(doorId: string, type: string): void {
    const door = this.doors.get(doorId);
    if (door) door.type = type;
  }

  canWalk(
    _roomId: string,
    _x: number,
    _y: number,
    _ignoreObjectId?: string,
  ): boolean {
    // Physics lives in the engine. The sandbox only has to be a writable clone.
    return true;
  }

  hasPath(
    _roomId: string,
    _from: { x: number; y: number },
    _to: { x: number; y: number },
    _ignoreObjectId?: string,
  ): boolean {
    return true;
  }

  bumpRevision(): void {
    this.revision += 1;
  }
}

export function sandboxFromSnapshot(snapshot: WorldSnapshot): SnapshotSandbox {
  return SnapshotSandbox.fromSnapshot(snapshot);
}

export function cloneSandbox(world: WorldMutator): WorldMutator {
  if (world instanceof SnapshotSandbox) return world.clone();
  const objects = world.objects.map(cloneObject);
  return new SnapshotSandbox({
    revision: world.revision,
    objects,
    player: world.getPlayerPose(),
    figures: new Map(),
    doors: new Map(),
    keysHeld: new Set(world.keysHeld),
  });
}

export function applyActionList(
  world: WorldMutator,
  envelopes: WorldActionEnvelope[],
  execute: WorldActionExecutor = executeWorldAction,
): WorldActionResult[] {
  const results: WorldActionResult[] = [];
  for (const envelope of envelopes) {
    results.push(execute(world, envelope));
  }
  return results;
}

function sortedIds(ids: readonly string[]): string {
  return [...ids].slice().sort().join("\0");
}

function locationFingerprint(
  entries: Array<{ id: string; location: ObjectLocation }>,
): string {
  return JSON.stringify(
    [...entries]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((entry) => [entry.id, entry.location]),
  );
}

function locationsFromResult(
  result: WorldActionResult,
): Array<{ id: string; location: ObjectLocation }> {
  const out: Array<{ id: string; location: ObjectLocation }> = [];
  for (const event of result.events) {
    switch (event.type) {
      case "object.dropped":
        out.push({
          id: event.objectId,
          location: {
            kind: "room",
            roomId: event.roomId,
            x: event.x,
            y: event.y,
          },
        });
        break;
      case "object.taken":
        out.push({
          id: event.objectId,
          location: { kind: "held", actor: event.actor },
        });
        break;
      case "object.given":
        out.push({
          id: event.objectId,
          location: { kind: "held", actor: event.to },
        });
        break;
      case "object.moved":
        out.push({
          id: event.objectId,
          location: { kind: "inside", objectId: event.intoObjectId },
        });
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Sandbox/live mismatch is an invariant violation: stop the rest of the transaction.
 * Same ok, same affected ids, same final object locations (from events, or worlds).
 */
export function assertReplayMatches(
  sandboxResult: WorldActionResult,
  liveResult: WorldActionResult,
  sandboxWorld?: WorldMutator,
  liveWorld?: WorldMutator,
): void {
  if (sandboxResult.ok !== liveResult.ok) {
    throw new Error(
      `replay mismatch: ok (${String(sandboxResult.ok)} vs ${String(liveResult.ok)})`,
    );
  }
  if (
    sortedIds(sandboxResult.affectedObjects) !==
    sortedIds(liveResult.affectedObjects)
  ) {
    throw new Error("replay mismatch: affectedObjects");
  }
  if (
    sortedIds(sandboxResult.affectedRooms) !==
    sortedIds(liveResult.affectedRooms)
  ) {
    throw new Error("replay mismatch: affectedRooms");
  }

  const sandboxLocations = sandboxWorld
    ? sandboxWorld.objects.map((object) => ({
        id: object.id,
        location: object.location,
      }))
    : locationsFromResult(sandboxResult);
  const liveLocations = liveWorld
    ? liveWorld.objects.map((object) => ({
        id: object.id,
        location: object.location,
      }))
    : locationsFromResult(liveResult);
  if (
    locationFingerprint(sandboxLocations) !== locationFingerprint(liveLocations)
  ) {
    throw new Error("replay mismatch: object locations");
  }
}

export function worldActionFromTool(
  name: string,
  input: Record<string, unknown>,
): WorldAction | null {
  switch (name) {
    case "move_to":
      return { type: "moveTo", x: asNumber(input.x), y: asNumber(input.y) };
    case "take":
      return { type: "take", objectId: asString(input.objectId) };
    case "drop":
      return {
        type: "drop",
        objectId: asString(input.objectId),
        ...(typeof input.x === "number" ? { x: input.x } : {}),
        ...(typeof input.y === "number" ? { y: input.y } : {}),
      };
    case "give": {
      const to = asString(input.to);
      return {
        type: "give",
        objectId: asString(input.objectId),
        to: to === "player" ? { kind: "player" } : { kind: "figure", id: to },
      };
    }
    case "put":
      return {
        type: "put",
        objectId: asString(input.objectId),
        intoObjectId: asString(input.intoObjectId),
      };
    case "open":
      return { type: "open", targetId: asString(input.targetId) };
    case "close":
      return { type: "close", targetId: asString(input.targetId) };
    case "activate":
      return { type: "activate", objectId: asString(input.objectId) };
    case "use":
      return {
        type: "use",
        objectId: asString(input.objectId),
        ...(typeof input.targetId === "string"
          ? { targetId: input.targetId }
          : {}),
      };
    case "traverse":
      return { type: "traverseDoor", doorId: asString(input.doorId) };
    default:
      return null;
  }
}

function toolResult(
  result: WorldActionResult,
  worldRevision: number,
): NpcToolResult {
  return {
    ok: result.ok,
    refusal: result.refusal,
    events: result.events,
    affectedObjects: result.affectedObjects,
    affectedRooms: result.affectedRooms,
    worldRevision,
  };
}

function stripHallucinatedActor(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const raw = { ...(input as Record<string, unknown>) };
  delete raw.actor;
  delete raw.source;
  return raw;
}

export function createNpcWorldSession(
  snapshot: WorldSnapshot,
  figureId: string,
  execute: WorldActionExecutor = executeWorldAction,
): NpcWorldSession {
  const world = sandboxFromSnapshot(snapshot);
  const successful: WorldActionEnvelope[] = [];

  return {
    world,
    successful,
    runTool(name: string, input: unknown): NpcToolResult {
      if (successful.length >= MAX_WORLD_ACTIONS_PER_TURN) {
        return toolResult(
          refused("turn action cap reached"),
          world.revision,
        );
      }
      const cleaned = stripHallucinatedActor(input);
      const action = worldActionFromTool(name, cleaned);
      if (!action) {
        return toolResult(refused("unknown or disallowed action"), world.revision);
      }
      const envelope: WorldActionEnvelope = {
        actor: { kind: "figure", id: figureId },
        source: "npc",
        action,
      };
      const result = execute(world, envelope);
      if (result.ok) successful.push(envelope);
      return toolResult(result, world.revision);
    },
  };
}

export { MAX_WORLD_ACTIONS_PER_TURN };
