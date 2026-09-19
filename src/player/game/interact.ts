/**
 * What the sanitar can reach, and what pressing E on it means.
 *
 * One resolver for figures, authored objects, live WorldObjectState, and the things
 * the sleeper put there. The ordering rule matters and is the thing format 3 got
 * wrong: it returned the nearest *figure* unconditionally before it looked at
 * anything else, so an object standing next to somebody was unreachable. Now
 * whichever is actually closer wins — which is what the player expects, and what
 * §06's ditch needs, where Кирилл is sitting on the manhole.
 */

import { findHotspot } from "../../shared/roomGrid";
import { toLocalPixels } from "../../shared/street";
import type { RoomHotspot } from "../../shared/room";
import { availableVerbs, type Verb, type VerbOption } from "../../shared/verbs";
import { t, getLocale, type SupportedLocale } from "../../shared/i18n";
import { actionLabel, actionRefusalText } from "../../shared/action-text";
import type { ActionOption } from "../../shared/world-action";
import { availableActions } from "../../shared/world-action-engine";
import type {
  ActorPose,
  ActorRef,
  WorldObjectState,
} from "../../shared/world-object";
import { bindWorldMutator, staticPlayerPose } from "./world-mutator";
import { fateOf, leverageOn, whoIsLed } from "./fates";
import { liveObjects } from "./object-collision";
import type { PlayerState } from "./player";
import {
  doorRefusal,
  interestHotspots,
  liveHotspots,
  type FigureState,
  type RoomState,
  type WorldState,
} from "./world";

/** How close the sanitar must be to speak to somebody, in pixels. */
export const FIGURE_REACH = 20;

export type ActionTarget =
  | { kind: "object"; id: string }
  | { kind: "figure"; id: string }
  | { kind: "door"; id: string }
  | { kind: "ground"; roomId: string; x: number; y: number };

export type ListActions = (
  world: WorldState,
  actor: ActorRef,
  target: ActionTarget,
) => ActionOption[];

export function defaultListActions(
  world: WorldState,
  actor: ActorRef,
  target: ActionTarget,
  playerPose: ActorPose | null = null,
): ActionOption[] {
  return availableActions(
    bindWorldMutator(world, staticPlayerPose(playerPose)),
    actor,
    target,
  );
}

export type InteractTarget =
  | {
      kind: "figure";
      figure: FigureState;
      prompt: string;
      /** All four, with the impossible ones carrying their reason. */
      verbs: VerbOption[];
      actions: ActionOption[];
    }
  | {
      kind: "object";
      object: WorldObjectState;
      prompt: string;
      actions: ActionOption[];
    }
  | { kind: "hotspot"; hotspot: RoomHotspot; prompt: string }
  | { kind: "door"; doorId: string; prompt: string };

export interface ActionRingRow {
  label: string;
  refusal: string | null;
  confirm: boolean;
  payload:
    | { kind: "verb"; verb: Verb }
    | { kind: "world"; action: ActionOption["action"] };
}

function nearestFigure(
  world: WorldState,
  player: PlayerState,
  room: RoomState,
): { figure: FigureState; distance: number } | null {
  if (room.kind === "meta") return null;
  let best: FigureState | null = null;
  let bestDistance = Infinity;
  for (const figure of world.figures) {
    if (figure.roomId !== room.id) continue;
    const local = toLocalPixels(room, player.x, player.y);
    const distance = Math.hypot(
      figure.x * room.tileSize - local.x,
      figure.y * room.tileSize - local.y,
    );
    if (distance <= FIGURE_REACH && distance < bestDistance) {
      best = figure;
      bestDistance = distance;
    }
  }
  return best ? { figure: best, distance: bestDistance } : null;
}

function hotspotDistance(
  hotspot: RoomHotspot,
  player: PlayerState,
  room: RoomState,
): number {
  const local = toLocalPixels(room, player.x, player.y);
  return Math.hypot(
    hotspot.x * room.tileSize - local.x,
    hotspot.y * room.tileSize - local.y,
  );
}

function objectDistance(
  object: WorldObjectState,
  player: PlayerState,
  room: RoomState,
): number | null {
  if (object.location.kind !== "room" || object.location.roomId !== room.id) {
    return null;
  }
  const local = toLocalPixels(room, player.x, player.y);
  const loc = object.location;
  const rx = loc.x * room.tileSize;
  const ry = loc.y * room.tileSize;
  if (!object.body) {
    return Math.hypot(rx - local.x, ry - local.y);
  }
  const rw = object.body.w * room.tileSize;
  const rh = object.body.h * room.tileSize;
  const inside =
    local.x >= rx && local.x < rx + rw && local.y >= ry && local.y < ry + rh;
  if (inside) return 0;
  const dx = Math.max(rx - local.x, 0, local.x - (rx + rw));
  const dy = Math.max(ry - local.y, 0, local.y - (ry + rh));
  return Math.hypot(dx, dy);
}

/** Every hotspot in the room right now: authored ones plus whatever the sleeper added. */
export function reachableHotspots(
  world: WorldState,
  room: RoomState,
): RoomHotspot[] {
  return [...liveHotspots(room), ...interestHotspots(world, room.id)];
}

/**
 * Whether this room offers a way to kill somebody.
 *
 * §9 has no weapons and there is no inventory, so the means is always a thing that is
 * already here — «провода, которые убьют при касании», the stove that hisses, the party
 * sticks. An object says so with `action: "lethal"`.
 */
export function lethalMeansIn(room: RoomState): boolean {
  return liveHotspots(room).some((hotspot) => hotspot.action === "lethal");
}

function verbsFor(
  world: WorldState,
  room: RoomState,
  figure: FigureState,
  locale?: SupportedLocale,
): VerbOption[] {
  return availableVerbs(
    {
      figureId: figure.id,
      fate: fateOf(world, figure.id),
      leverage: leverageOn(world, figure.id),
      lethalMeans: lethalMeansIn(room),
      leading: whoIsLed(world),
      roomKind: room.kind,
    },
    locale,
  );
}

function floorObjects(world: WorldState, roomId: string): WorldObjectState[] {
  return liveObjects(world).filter(
    (object) =>
      object.location.kind === "room" && object.location.roomId === roomId,
  );
}

function nearestObject(
  world: WorldState,
  player: PlayerState,
  room: RoomState,
): { object: WorldObjectState; distance: number } | null {
  let best: WorldObjectState | null = null;
  let bestDistance = Infinity;
  for (const object of floorObjects(world, room.id)) {
    const distance = objectDistance(object, player, room);
    if (distance === null) continue;
    const reach = (object.interaction?.reach ?? 1.4) * room.tileSize;
    if (distance <= reach && distance < bestDistance) {
      best = object;
      bestDistance = distance;
    }
  }
  return best ? { object: best, distance: bestDistance } : null;
}

export function findTarget(
  world: WorldState,
  room: RoomState,
  player: PlayerState,
  locale?: SupportedLocale,
  listActions?: ListActions,
): InteractTarget | null {
  // A door that just turned us away outranks everything: the player pressed into it on
  // purpose, and saying why is more useful than offering to look at a nearby chair.
  if (player.refusedDoorId) {
    const door = world.doorById.get(player.refusedDoorId);
    if (door) {
      return {
        kind: "door",
        doorId: door.id,
        prompt: doorRefusal(door, locale),
      };
    }
  }

  const figure = nearestFigure(world, player, room);
  const object = nearestObject(world, player, room);
  const objectIds = new Set(liveObjects(world).map((entry) => entry.id));
  const local = toLocalPixels(room, player.x, player.y);
  const hotspot = findHotspot(
    reachableHotspots(world, room).filter(
      (entry) =>
        !objectIds.has(entry.id) &&
        !objectIds.has(entry.propId ?? "") &&
        !(
          entry.id.startsWith("interest:") &&
          objectIds.has(entry.id.slice("interest:".length))
        ),
    ),
    local.x,
    local.y,
    room.tileSize,
  );

  const actionsFor: ListActions =
    listActions ??
    ((liveWorld, actor, target) =>
      defaultListActions(liveWorld, actor, target, {
        roomId: room.id,
        x: local.x / room.tileSize,
        y: local.y / room.tileSize,
      }));

  const asFigure = (state: FigureState): InteractTarget => {
    const verbs = verbsFor(world, room, state, locale);
    const actions = actionsFor(
      world,
      { kind: "player" },
      {
        kind: "figure",
        id: state.id,
      },
    );
    const more =
      verbs.some((option) => option.verb !== "talk" && !option.refusal) ||
      actions.some((option) => !option.refusal);
    const talkPrompt = t("interact.talk_to", { name: state.name }, locale);
    const moreActions = more
      ? t("interact.more_actions", undefined, locale)
      : "";
    return {
      kind: "figure",
      figure: state,
      prompt: `${talkPrompt}${moreActions}`,
      verbs,
      actions,
    };
  };

  const asObject = (state: WorldObjectState): InteractTarget => {
    const actions = actionsFor(
      world,
      { kind: "player" },
      {
        kind: "object",
        id: state.id,
      },
    );
    return {
      kind: "object",
      object: state,
      prompt: state.interaction?.prompt ?? state.name,
      actions,
    };
  };

  type Ranked = { distance: number; target: InteractTarget };
  const ranked: Ranked[] = [];
  if (figure)
    ranked.push({ distance: figure.distance, target: asFigure(figure.figure) });
  if (object)
    ranked.push({ distance: object.distance, target: asObject(object.object) });
  if (hotspot) {
    ranked.push({
      distance: hotspotDistance(hotspot, player, room),
      target: { kind: "hotspot", hotspot, prompt: hotspot.prompt },
    });
  }
  ranked.sort((a, b) => a.distance - b.distance);
  return ranked[0]?.target ?? null;
}

/** E on a carryable: take if the engine allows it, otherwise examine. */
export function primaryObjectAction(
  actions: readonly ActionOption[],
): ActionOption | null {
  const leave = actions.find(
    (option) => option.action.type === "leave" && !option.refusal,
  );
  if (leave) return leave;
  const take = actions.find(
    (option) => option.action.type === "take" && !option.refusal,
  );
  if (take) return take;
  const examine = actions.find(
    (option) => option.affordance === "examine" && !option.refusal,
  );
  if (examine) return examine;
  return actions.find((option) => !option.refusal) ?? null;
}

function labelForAction(option: ActionOption): string {
  const label = actionLabel(option.action, getLocale());
  return (option.action.type === "give" || option.action.type === "put") &&
    option.label
    ? `${label}: ${option.label}`
    : label;
}

/**
 * Figure ring: talk/press/lead/kill always, then object-facing rows from the engine
 * (give when the sanitar holds something). Object ring: engine rows only.
 * Refused rows stay, struck through by the ring.
 */
export function actionRingRowsFor(input: {
  kind: "figure" | "object";
  verbs: readonly VerbOption[];
  actions: readonly ActionOption[];
}): ActionRingRow[] {
  const rows: ActionRingRow[] = [];
  if (input.kind === "figure") {
    for (const option of input.verbs) {
      rows.push({
        label: option.label,
        refusal: option.refusal,
        confirm: option.verb === "kill",
        payload: { kind: "verb", verb: option.verb },
      });
    }
  }
  for (const option of input.actions) {
    if (
      input.kind === "figure" &&
      option.action.type !== "give" &&
      option.affordance !== "give"
    ) {
      continue;
    }
    rows.push({
      label: labelForAction(option),
      refusal: option.refusal
        ? actionRefusalText(option.refusal, getLocale())
        : null,
      confirm: false,
      payload: { kind: "world", action: option.action },
    });
  }
  return rows;
}
