/** Event-driven NPC decisions. No rendering, server, or provider dependencies. */
import type { WorldSnapshot } from "./ai";
import type { MemoryEpisode } from "./episodic-memory";
import type { WorldAction } from "./world-action";

export interface NpcGoal {
  figureId: string;
  goalId: string;
  goal: string;
  lifetimeSeconds: number;
}

export interface NpcDecisionCause {
  rootId: string;
  kind: "receipt" | "goal" | "discovery" | "blocked";
  evidenceIds?: string[];
}

export interface NpcTaskDependencies {
  figureId: string;
  objectIds: string[];
  doorIds: string[];
  /** Figure ids, or the reserved id "player". */
  actorIds: string[];
}

export interface NpcTask {
  id: string;
  figureId: string;
  summary: string;
  actions: WorldAction[];
  dependencies: NpcTaskDependencies;
  contextKey: string;
  lifetimeSeconds: number;
  cause: NpcDecisionCause;
}

export interface NpcDecisionRequest {
  slug: string;
  requestId: string;
  runId: string;
  cycleNumber: number;
  figureId: string;
  cause: NpcDecisionCause;
  world: WorldSnapshot;
  memories?: MemoryEpisode[];
  goal?: NpcGoal;
  currentTask?: NpcTask;
}

export interface NpcDecisionDiagnostics {
  model?: string;
  confidence?: number;
  reason?: string;
  selectedId?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

export interface NpcDecisionResult {
  requestId: string;
  contextKey: string;
  dependencies: NpcTaskDependencies;
  status: "selected" | "wait" | "deferred" | "unavailable";
  task?: NpcTask;
  diagnostics?: NpcDecisionDiagnostics;
}

/** Live read-only views suffice; no geometry or history cloning is required. */
export interface NpcFingerprintWorld {
  objects: readonly WorldSnapshot["objects"][number][];
  doors: readonly WorldSnapshot["doors"][number][];
  figures: readonly Pick<
    WorldSnapshot["figures"][number],
    "id" | "roomId" | "fate"
  >[];
  player: Pick<WorldSnapshot["player"], "roomId">;
}

/** Stable over ordinary walking and unrelated changes, sensitive to real dependencies. */
export function npcDependencyFingerprint(
  world: NpcFingerprintWorld,
  dependencies: NpcTaskDependencies,
): string {
  const actorIds = [
    ...new Set([dependencies.figureId, ...dependencies.actorIds]),
  ].sort();
  const objects = new Map(world.objects.map((object) => [object.id, object]));
  const doors = new Map(world.doors.map((door) => [door.id, door]));
  const figures = new Map(world.figures.map((figure) => [figure.id, figure]));
  const input = JSON.stringify({
    actors: actorIds.map((id) => {
      if (id === "player") return [id, world.player.roomId];
      const figure = figures.get(id);
      return [id, figure?.roomId ?? null, figure?.fate ?? null];
    }),
    objects: [...new Set(dependencies.objectIds)].sort().map((id) => {
      const object = objects.get(id);
      return [
        id,
        object
          ? [
              object.location,
              object.state,
              object.mobility,
              object.affordances,
              object.body,
              object.keyId,
              object.profile,
            ]
          : null,
      ];
    }),
    doors: [...new Set(dependencies.doorIds)].sort().map((id) => {
      const door = doors.get(id);
      return [
        id,
        door
          ? [
              door.fromRoomId,
              door.toRoomId,
              door.type,
              door.closed,
              door.hidden,
              door.passable,
              door.keyId,
              door.x,
              door.y,
              door.w,
              door.h,
              door.toX,
              door.toY,
            ]
          : null,
      ];
    }),
  });
  // This is a stale-state guard, not a cryptographic signature or authority check.
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++)
    hash = Math.imul(hash ^ input.charCodeAt(i), 16777619);
  return `npc:${(hash >>> 0).toString(16)}`;
}

export function npcTaskIsCurrent(
  world: NpcFingerprintWorld,
  task: NpcTask,
): boolean {
  return npcDependencyFingerprint(world, task.dependencies) === task.contextKey;
}
