/**
 * STUB. Agent feat/npc-world-engine replaces this with the real executor.
 *
 * Signature is frozen. Do not change the export names or argument order.
 * Other slices import these and inject a fake in their own tests if needed.
 *
 * Must stay free of DOM and node APIs.
 */

import type {
  ActionOption,
  WorldActionEnvelope,
  WorldActionResult,
} from "./world-action";
import type { ActorRef, WorldMutator } from "./world-object";

export const ENGINE_STUB = true;

export function refused(message: string): WorldActionResult {
  return {
    ok: false,
    refusal: message,
    affectedRooms: [],
    affectedObjects: [],
    events: [],
  };
}

export function executeWorldAction(
  _world: WorldMutator,
  envelope: WorldActionEnvelope,
): WorldActionResult {
  if (envelope.source === "npc") {
    const actor = envelope.actor;
    if (actor.kind !== "figure") {
      return refused("npc actor must be a figure; server wraps figureId");
    }
  }
  return refused("world-action-engine stub: engine agent implements this");
}

export function availableActions(
  _world: WorldMutator,
  _actor: ActorRef,
  _target:
    | { kind: "object"; id: string }
    | { kind: "figure"; id: string }
    | { kind: "door"; id: string }
    | { kind: "ground"; roomId: string; x: number; y: number },
): ActionOption[] {
  return [];
}

export function cloneWorldMutator(_world: WorldMutator): WorldMutator {
  throw new Error("world-action-engine stub: cloneWorldMutator not implemented");
}
