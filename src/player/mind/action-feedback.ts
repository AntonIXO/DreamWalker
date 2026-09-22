/** The body confirms what a model's sandbox could only predict. */
import type { NpcExecutionFeedback } from "../../shared/ai";
import type {
  WorldAction,
  WorldActionEnvelope,
  WorldActionResult,
} from "../../shared/world-action";
import { replayWorldActions } from "../game/npc-action-queue";
import {
  MAX_WORLD_ACTIONS_PER_TURN,
  PLAYER_ACTION_TYPES,
} from "../../shared/world-action";

export function replayNpcActions(
  figureId: string,
  actions: readonly WorldAction[],
  execute: (envelope: WorldActionEnvelope) => WorldActionResult,
  revision: () => number,
) {
  const execution: NpcExecutionFeedback[] = [];
  const outcome = replayWorldActions(
    (envelope) => {
      try {
        const result = execute(envelope);
        execution.push({
          action: envelope.action,
          ok: result.ok,
          refusal: result.refusal,
          events: result.events,
          worldRevision: revision(),
        });
        return result;
      } catch (error) {
        execution.push({
          action: envelope.action,
          ok: false,
          refusal: error instanceof Error ? error.message : String(error),
          events: [],
          worldRevision: revision(),
        });
        throw error;
      }
    },
    { kind: "figure", id: figureId },
    "npc",
    actions,
  );
  return { ...outcome, execution };
}

/** Reject an unbound command before any effect, then replay the valid plan in order. */
export function replayPlayerActions(
  envelopes: readonly WorldActionEnvelope[],
  execute: (envelope: WorldActionEnvelope) => WorldActionResult,
  revision: () => number,
) {
  const execution: NpcExecutionFeedback[] = [];
  if (
    envelopes.length > MAX_WORLD_ACTIONS_PER_TURN ||
    envelopes.some(
      (entry) =>
        entry.actor.kind !== "player" ||
        entry.source !== "player" ||
        !PLAYER_ACTION_TYPES.has(entry.action.type),
    )
  ) {
    return {
      ok: false,
      executed: 0,
      refusal: "invalid player action plan",
      execution,
    };
  }
  let envelopeIndex = 0;
  const result = replayWorldActions(
    (envelope) => {
      const original = envelopes[envelopeIndex++]!;
      const causedEnvelope = original.cause
        ? { ...envelope, cause: original.cause }
        : envelope;
      try {
        const outcome = execute(causedEnvelope);
        execution.push({
          action: envelope.action,
          ok: outcome.ok,
          refusal: outcome.refusal,
          events: outcome.events,
          worldRevision: revision(),
        });
        return outcome;
      } catch (error) {
        execution.push({
          action: envelope.action,
          ok: false,
          refusal: error instanceof Error ? error.message : String(error),
          events: [],
          worldRevision: revision(),
        });
        throw error;
      }
    },
    { kind: "player" },
    "player",
    envelopes.map((entry) => entry.action),
  );
  return { ...result, execution };
}
