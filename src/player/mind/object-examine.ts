/** Offline examination uses the live object, not its old position in a room. */
import { lookAt } from "../../../dreams/son/looks";
import type { ExamineResult } from "../../shared/ai";
import type { ActorPose } from "../../shared/world-object";
import { availableActions } from "../../shared/world-action-engine";
import { carriedInventoryObjects } from "../game/inventory";
import { bindWorldMutator, staticPlayerPose } from "../game/world-mutator";
import type { WorldState } from "../game/world";
import type { ExamineRequest } from "./types";

export function examineWorldObject(
  world: WorldState,
  request: ExamineRequest,
  playerPose: ActorPose | null,
  knownShardIds: readonly string[],
  locale: "ru" | "en",
): ExamineResult {
  const ru = locale === "ru";
  const refused = (
    reply = ru
      ? "Сейчас эта вещь недоступна для осмотра."
      : "That object cannot be examined from here.",
  ): ExamineResult => ({
    reply,
    yieldedShardId: null,
    clueObservedId: null,
    leverageLearned: null,
  });
  const object = request.objectId
    ? world.objectById.get(request.objectId)
    : null;
  if (!object) return refused();
  if (!playerPose) {
    // Older callers have no body binding. Ownership is enough to inspect something
    // carried, but target coordinates must never become a fabricated player pose.
    if (
      !carriedInventoryObjects(world.objects).some(
        (entry) => entry.object.id === object.id,
      )
    )
      return refused();
    playerPose = { roomId: world.currentRoomId, x: 0, y: 0 };
  }
  if (request.roomId !== null && request.roomId !== playerPose.roomId)
    return refused();
  const option = availableActions(
    bindWorldMutator(world, staticPlayerPose(playerPose)),
    { kind: "player" },
    { kind: "object", id: object.id },
  ).find((candidate) => candidate.action.type === "examine");
  if (!option || option.refusal) return refused();
  if (object.interaction?.refusal) return refused(object.interaction.refusal);

  const baseline = world.baseObjects.find(
    (candidate) => candidate.id === object.id,
  );
  const sourceRooms =
    baseline?.location.kind === "room"
      ? world.artifact.rooms.filter(
          (room) =>
            baseline.location.kind === "room" &&
            room.id === baseline.location.roomId,
        )
      : world.artifact.rooms;
  const source = sourceRooms
    .flatMap((room) => room.hotspots)
    .find(
      (hotspot) => hotspot.id === object.id || hotspot.propId === object.id,
    );
  const clue = world.artifact.content.clues.find(
    (candidate) => candidate.id === object.clueId,
  );
  const sensory =
    lookAt(source?.id)?.reply ??
    object.sensorySeed ??
    clue?.sensorySeed ??
    source?.prompt ??
    object.name;
  const facts: string[] = [];
  if (object.state.broken !== undefined)
    facts.push(
      object.state.broken
        ? ru
          ? "есть повреждения"
          : "damaged"
        : ru
          ? "повреждений нет"
          : "intact",
    );
  if (object.state.wet !== undefined)
    facts.push(
      object.state.wet
        ? ru
          ? "поверхность мокрая"
          : "wet surface"
        : ru
          ? "поверхность сухая"
          : "dry surface",
    );
  if (object.state.dirty !== undefined)
    facts.push(
      object.state.dirty
        ? ru
          ? "видна грязь"
          : "dirty"
        : ru
          ? "чисто"
          : "clean",
    );
  if (object.state.open !== undefined)
    facts.push(
      object.state.open ? (ru ? "открыто" : "open") : ru ? "закрыто" : "closed",
    );
  if (object.state.inscription !== undefined)
    facts.push(
      object.state.inscription
        ? `${ru ? "надпись" : "inscription"}: «${object.state.inscription}»`
        : ru
          ? "надписи нет"
          : "no inscription",
    );
  const shard = object.holdsShardId;
  return {
    // Once physical state changes, old authored prose may describe a dry, intact,
    // or differently inscribed object. Current facts take precedence over that line.
    reply: facts.length > 0 ? `${object.name}: ${facts.join("; ")}.` : sensory,
    clueObservedId: clue?.id ?? null,
    yieldedShardId:
      shard &&
      !knownShardIds.includes(shard) &&
      world.artifact.shards.some((candidate) => candidate.id === shard)
        ? shard
        : null,
    leverageLearned: null,
  };
}
