/** A visible role never replaces actor identity or knowledge of the original person. */
import type { WorldSnapshot } from "./ai";
import type { WorldMindEvent } from "./world-mind";
import type { WorldObjectState } from "./world-object";

export const SOCIAL_ROLES = {
  hudozhnik: {
    name: { ru: "Художник", en: "The Artist" },
    intent: "gather",
    request: { ru: "Собрать зрителей", en: "Gather an audience" },
    expectation: "Stage a viewing, explain the work, and let others take part.",
  },
  lysyi: {
    name: { ru: "Лысый", en: "The Bald Man" },
    intent: "inspect",
    request: { ru: "Начать проверку", en: "Begin an inspection" },
    expectation:
      "Ask brief calm questions and finish the inspection coherently.",
  },
  "ded-slava": {
    name: { ru: "Дед Слава", en: "Grandpa Slava" },
    intent: "helpMove",
    request: { ru: "Позвать помочь", en: "Ask for a hand" },
    expectation: "Work alongside the helper and finish the practical job.",
  },
} as const;

export type SocialRoleId = keyof typeof SOCIAL_ROLES;
export interface RoleRecognition {
  roleId: string;
  cycle: number;
  eventSequence: number;
  /** Absent means a direct witness; a report preserves the named source. */
  sourceId?: string;
}
export type RoleRecognitionState = Record<string, RoleRecognition[]>;

export function roleOfEquipment(
  objects: readonly Pick<WorldObjectState, "profile" | "state" | "location">[],
): string | null {
  return (
    objects.find(
      (object) =>
        object.state.wornBy?.kind === "player" &&
        object.profile?.wear?.appearanceFigureId &&
        object.location.kind === "held" &&
        object.location.actor.kind === "player",
    )?.profile?.wear?.appearanceFigureId ?? null
  );
}

/** Called only with a committed, visibility-captured action receipt. */
export function recordRoleWitnesses(
  knowledge: RoleRecognitionState,
  objects: readonly WorldObjectState[],
  event: WorldMindEvent,
): void {
  if (event.actor?.kind !== "player" || event.actionType !== "wear") return;
  const objectId =
    event.action && "objectId" in event.action ? event.action.objectId : null;
  const roleId = objects.find((object) => object.id === objectId)?.profile?.wear
    ?.appearanceFigureId;
  if (!roleId) return;
  for (const figureId of event.witnessIds) {
    const view = event.witnessViews[figureId];
    if (!view?.before.actor || !view.after.actor) continue;
    const list = knowledge[figureId] ?? [];
    knowledge[figureId] = [
      ...list.filter((entry) => entry.roleId !== roleId),
      { roleId, cycle: event.cycle, eventSequence: event.sequence },
    ].slice(-32);
  }
}

export function recordRoleReport(
  knowledge: RoleRecognitionState,
  report: { speakerId: string; listenerId: string; originId: string },
): void {
  const match = /^world:(\d+):(\d+)$/.exec(report.originId);
  if (!match) return;
  const source = knowledge[report.speakerId]?.find(
    (entry) =>
      entry.cycle === Number(match[1]) &&
      entry.eventSequence === Number(match[2]),
  );
  if (!source) return;
  const known = knowledge[report.listenerId] ?? [];
  if (known.some((entry) => entry.roleId === source.roleId && !entry.sourceId))
    return;
  knowledge[report.listenerId] = [
    ...known.filter((entry) => entry.roleId !== source.roleId),
    { ...source, sourceId: report.speakerId },
  ].slice(-32);
}

export function perceivedPlayerIdentity(
  world: Pick<WorldSnapshot, "objects" | "roleRecognition">,
  figureId: string,
) {
  const roleId = roleOfEquipment(world.objects);
  const evidence = roleId
    ? (world.roleRecognition?.[figureId] ?? []).filter(
        (entry) => entry.roleId === roleId,
      )
    : [];
  const original = roleId === figureId;
  const direct = evidence.some((entry) => !entry.sourceId);
  const role =
    roleId && roleId in SOCIAL_ROLES
      ? SOCIAL_ROLES[roleId as SocialRoleId]
      : null;
  return {
    roleId,
    recognition: (original || direct
      ? "recognized"
      : evidence.length
        ? "uncertain"
        : "role") as "recognized" | "uncertain" | "role",
    evidence,
    originalPersonPresent: original,
    availableRequest: role?.intent ?? null,
    expectation: role?.expectation ?? null,
  };
}
