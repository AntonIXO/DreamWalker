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
import {
  MAX_WORLD_ACTIONS_PER_TURN,
  PLAYER_ACTION_TYPES,
} from "./world-action";
import {
  executeWorldAction,
  refused,
  cloneWorldMutator,
} from "./world-action-engine";
import type {
  ActorPose,
  ActorRef,
  ObjectLocation,
  WorldDoorView,
  WorldMutator,
  WorldObjectState,
} from "./world-object";
import {
  isActorRef,
  findChebyshevPath,
  solidObjectCovers,
} from "./world-object";
import { cellAt, isWalkableCell } from "./roomGrid";

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
  "approach",
  "occupy",
  "leave",
  "wear",
  "remove_wear",
  "detach",
  "move_object",
  "empty",
  "request_role",
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

export interface WorldActionAttempt {
  toolName: string;
  /** Actor/source fields are stripped; the receipt records the tool's actual input. */
  input: Record<string, unknown>;
  action: WorldAction | null;
  actor: ActorRef;
  revisionBefore: number;
  result: NpcToolResult;
  cached: boolean;
}

export type NpcWorldAttempt = WorldActionAttempt;

export interface NpcPlanPreview {
  ok: boolean;
  refusal: string | null;
  baseRevision: number;
  worldRevision: number;
  steps: Array<{ action: WorldAction; result: NpcToolResult }>;
  actorPose: ActorPose | null;
  /** Projected state for the server to derive observations; omit from tool JSON. */
  world: WorldMutator;
}

export interface NpcWorldSession {
  readonly world: WorldMutator;
  readonly successful: WorldActionEnvelope[];
  /** Every physical attempt within the turn budget, including refusals and retries. */
  readonly attempts: readonly NpcWorldAttempt[];
  readonly remainingActions: number;
  runTool(name: string, input: unknown): NpcToolResult;
  /** Simulate a plan on an isolated copy without spending the physical budget. */
  preview(actions: readonly WorldAction[]): NpcPlanPreview;
}

export interface PlayerWorldSession {
  readonly world: WorldMutator;
  readonly successful: WorldActionEnvelope[];
  readonly attempts: readonly WorldActionAttempt[];
  readonly remainingActions: number;
  runAction(action: WorldAction): NpcToolResult;
  preview(actions: readonly WorldAction[]): NpcPlanPreview;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function objectFromSnapshot(raw: WorldSnapshotObject): WorldObjectState {
  return {
    ...(raw.profile ? { profile: structuredClone(raw.profile) } : {}),
    id: raw.id,
    name: raw.name,
    location: structuredClone(raw.location),
    mobility: raw.mobility,
    affordances: [...raw.affordances],
    body: raw.body ? { ...raw.body } : null,
    visual: { role: null, image: null },
    interaction: raw.interaction ? { ...raw.interaction } : null,
    state: structuredClone(raw.state),
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

function snapshotObjectFromState(
  object: WorldObjectState,
): WorldSnapshotObject {
  return {
    ...(object.profile ? { profile: structuredClone(object.profile) } : {}),
    interaction: object.interaction ? { ...object.interaction } : null,
    id: object.id,
    name: object.name,
    location: structuredClone(object.location),
    mobility: object.mobility,
    affordances: [...object.affordances],
    state: structuredClone(object.state),
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
  figurePoses: Map<string, ActorPose>;
  doorById: Map<string, WorldDoorView>;
  private player: ActorPose | null;
  private readonly geometry: NonNullable<WorldSnapshot["geometry"]>;

  constructor(init: {
    revision: number;
    objects: WorldObjectState[];
    player: ActorPose | null;
    figures: Map<string, ActorPose>;
    doors: Map<string, WorldDoorView>;
    keysHeld?: Set<string>;
    geometry?: WorldSnapshot["geometry"];
  }) {
    this.geometry = structuredClone(init.geometry ?? {});
    this.revision = init.revision;
    this.objects = init.objects;
    this.objectById = new Map(
      init.objects.map((object) => [object.id, object]),
    );
    this.player = init.player;
    this.figurePoses = init.figures;
    this.doorById = init.doors;
    this.keysHeld = init.keysHeld ?? keysFromObjects(init.objects);
  }

  static fromSnapshot(snapshot: WorldSnapshot): SnapshotSandbox {
    const objects = (snapshot.objects ?? []).map(objectFromSnapshot);
    const figures = new Map<string, ActorPose>();
    for (const figure of snapshot.figures) {
      // Absent figures remain in narrative snapshots, but have no body to
      // execute tools or receive objects in the projected world.
      if (figure.fate === "dead" || figure.fate === "gone") continue;
      figures.set(figure.id, {
        roomId: figure.roomId,
        x: figure.x ?? 0,
        y: figure.y ?? 0,
      });
    }
    const doors = new Map<string, WorldDoorView>();
    for (const door of snapshot.doors) {
      if (door.hidden) continue;
      doors.set(door.id, {
        id: door.id,
        type: door.type,
        fromRoomId: door.fromRoomId,
        toRoomId: door.toRoomId,
        x: door.x ?? 0,
        y: door.y ?? 0,
        w: door.w ?? 1,
        h: door.h ?? 1,
        closed: door.closed,
        passable: door.passable,
        keyId: door.keyId ?? null,
        threshold: door.threshold ?? "door",
        toX: door.toX ?? 1,
        toY: door.toY ?? 1,
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
      geometry: snapshot.geometry,
      keysHeld: new Set(snapshot.keysHeld ?? []),
      revision: snapshot.worldRevision ?? 0,
      objects,
      player,
      figures,
      doors,
    });
  }

  clone(): SnapshotSandbox {
    // Held locations contain nested actor references. A projected world must
    // not share them with the actual turn even when a caller edits the preview.
    const objects = this.objects.map((object) => structuredClone(object));
    const figures = new Map<string, ActorPose>();
    for (const [id, pose] of this.figurePoses) figures.set(id, clonePose(pose));
    const doors = new Map<string, WorldDoorView>();
    for (const [id, door] of this.doorById) doors.set(id, cloneDoor(door));
    return new SnapshotSandbox({
      geometry: this.geometry,
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

  roomTileSize(roomId: string): number {
    return this.geometry[roomId]?.tileSize ?? 16;
  }

  setPlayerPose(pose: ActorPose): void {
    this.player = clonePose(pose);
  }

  getFigurePose(figureId: string): ActorPose | null {
    const pose = this.figurePoses.get(figureId);
    return pose ? clonePose(pose) : null;
  }

  setFigurePose(figureId: string, pose: ActorPose): void {
    this.figurePoses.set(figureId, clonePose(pose));
  }

  getDoor(doorId: string): WorldDoorView | null {
    const door = this.doorById.get(doorId);
    return door ? cloneDoor(door) : null;
  }

  setDoorType(doorId: string, type: string): void {
    const door = this.doorById.get(doorId);
    if (door) door.type = type;
  }

  setDoorClosed(doorId: string, closed: boolean): void {
    const door = this.doorById.get(doorId);
    if (door) door.closed = closed;
  }

  isWalkableTile(roomId: string, x: number, y: number): boolean {
    const grid = this.geometry[roomId];
    return !!grid && isWalkableCell(cellAt(grid, Math.floor(x), Math.floor(y)));
  }

  canPassDoor(doorId: string): boolean {
    const door = this.doorById.get(doorId);
    if (!door) return false;
    if (door.type === "open" || door.type === "ledge") return true;
    if (door.type === "sealed") return false;
    if (door.type === "keyLock") {
      return door.keyId !== null && this.keysHeld.has(door.keyId);
    }
    return door.passable ?? false;
  }

  canWalk(
    roomId: string,
    x: number,
    y: number,
    ignoreObjectId?: string,
  ): boolean {
    return (
      this.isWalkableTile(roomId, x, y) &&
      !solidObjectCovers(this.objects, roomId, x, y, ignoreObjectId)
    );
  }

  hasPath(
    roomId: string,
    from: ActorPose | { x: number; y: number },
    to: { x: number; y: number },
    ignoreObjectId?: string,
  ): boolean {
    return (
      findChebyshevPath(
        from,
        to,
        (x, y) =>
          (x === Math.round(from.x) && y === Math.round(from.y)) ||
          this.canWalk(roomId, x, y, ignoreObjectId),
      ) !== null
    );
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
  return cloneWorldMutator(world);
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
          location: isActorRef(event.actor)
            ? { kind: "held", actor: event.actor }
            : { kind: "removed" },
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
    case "approach":
    case "occupy":
    case "wear":
    case "detach":
    case "empty":
      return { type: name, objectId: asString(input.objectId) };
    case "leave":
      return { type: "leave" };
    case "remove_wear":
      return { type: "removeWear", objectId: asString(input.objectId) };
    case "move_object":
      return {
        type: "moveObject",
        objectId: asString(input.objectId),
        x: asNumber(input.x),
        y: asNumber(input.y),
      };
    case "request_role":
      if (!["gather", "inspect", "helpMove"].includes(asString(input.intent)))
        return null;
      return {
        type: "requestRole",
        intent: input.intent as "gather" | "inspect" | "helpMove",
        ...(typeof input.objectId === "string"
          ? { objectId: input.objectId }
          : {}),
      };
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
  return createActorWorldSession(
    snapshot,
    { kind: "figure", id: figureId },
    "npc",
    execute,
  );
}

export function createPlayerWorldSession(
  snapshot: WorldSnapshot,
  execute: WorldActionExecutor = executeWorldAction,
): PlayerWorldSession {
  return createActorWorldSession(
    snapshot,
    { kind: "player" },
    "player",
    execute,
  );
}

function createActorWorldSession(
  snapshot: WorldSnapshot,
  actor: ActorRef,
  source: "npc" | "player",
  execute: WorldActionExecutor,
): NpcWorldSession & PlayerWorldSession {
  const world = sandboxFromSnapshot(snapshot);
  const successful: WorldActionEnvelope[] = [];
  const attempts: WorldActionAttempt[] = [];
  const refusals = new Map<string, NpcToolResult>();
  const remainingActions = () => MAX_WORLD_ACTIONS_PER_TURN - attempts.length;
  const bindAction = (action: WorldAction): WorldActionEnvelope => ({
    actor: { ...actor },
    source,
    action: structuredClone(action),
  });

  const perform = (target: WorldMutator, envelope: WorldActionEnvelope) =>
    source === "player" && !PLAYER_ACTION_TYPES.has(envelope.action.type)
      ? refused("player item commands cannot perform this action")
      : execute(target, envelope);
  const runAction = (
    name: string,
    input: Record<string, unknown>,
    action: WorldAction | null,
  ): NpcToolResult => {
    if (remainingActions() <= 0)
      return toolResult(refused("turn action cap reached"), world.revision);
    const revisionBefore = world.revision;
    let result: NpcToolResult;
    let cached = false;
    if (!action) {
      result = toolResult(
        refused("unknown or disallowed action"),
        world.revision,
      );
    } else {
      const key = `${revisionBefore}:${JSON.stringify(
        action,
        (_key, value: unknown) =>
          value && typeof value === "object" && !Array.isArray(value)
            ? Object.fromEntries(
                Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
              )
            : value,
      )}`;
      const previous = refusals.get(key);
      if (previous) {
        result = structuredClone(previous);
        cached = true;
      } else {
        const envelope = bindAction(action);
        result = toolResult(perform(world, envelope), world.revision);
        if (result.ok) successful.push(structuredClone(envelope));
        else refusals.set(key, structuredClone(result));
      }
    }
    attempts.push({
      toolName: name,
      input: structuredClone(input),
      action: action ? structuredClone(action) : null,
      actor: { ...actor },
      revisionBefore,
      result: structuredClone(result),
      cached,
    });
    return result;
  };

  return {
    world,
    successful,
    attempts,
    get remainingActions() {
      return remainingActions();
    },
    runTool(name: string, input: unknown): NpcToolResult {
      const cleaned = stripHallucinatedActor(input);
      return runAction(name, cleaned, worldActionFromTool(name, cleaned));
    },
    runAction(action: WorldAction): NpcToolResult {
      const cleaned = stripHallucinatedActor(action);
      return runAction(action.type, cleaned, cleaned as unknown as WorldAction);
    },
    preview(actions: readonly WorldAction[]): NpcPlanPreview {
      const projected = world.clone();
      const baseRevision = world.revision;
      const steps: NpcPlanPreview["steps"] = [];
      let refusal: string | null = null;
      if (actions.length > remainingActions()) {
        refusal = "plan exceeds remaining action budget";
      } else {
        for (const action of actions) {
          const envelope = bindAction(action);
          const result = toolResult(
            perform(projected, envelope),
            projected.revision,
          );
          steps.push({ action: structuredClone(action), result });
          if (!result.ok) {
            refusal = result.refusal ?? "action refused";
            break;
          }
        }
      }
      return {
        ok: refusal === null,
        refusal,
        baseRevision,
        worldRevision: projected.revision,
        steps,
        actorPose:
          actor.kind === "player"
            ? projected.getPlayerPose()
            : projected.getFigurePose(actor.id),
        world: projected,
      };
    },
  };
}

export { MAX_WORLD_ACTIONS_PER_TURN };
