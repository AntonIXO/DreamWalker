/**
 * What the sanitar can reach, and what pressing E on it means.
 *
 * One resolver for figures, authored objects and the things the sleeper put there. The
 * ordering rule matters and is the thing format 3 got wrong: it returned the nearest
 * *figure* unconditionally before it looked at anything else, so an object standing next
 * to somebody was unreachable. Now whichever is actually closer wins — which is what the
 * player expects, and what §06's ditch needs, where Кирилл is sitting on the manhole.
 */

import { findHotspot } from "../../shared/roomGrid";
import { toLocalPixels } from "../../shared/street";
import type { RoomHotspot } from "../../shared/room";
import { availableVerbs, type VerbOption } from "../../shared/verbs";
import { fateOf, leverageOn, whoIsLed } from "./fates";
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

export type InteractTarget =
  | {
      kind: "figure";
      figure: FigureState;
      prompt: string;
      /** All four, with the impossible ones carrying their reason. */
      verbs: VerbOption[];
    }
  | { kind: "hotspot"; hotspot: RoomHotspot; prompt: string }
  | { kind: "door"; doorId: string; prompt: string };

function nearestFigure(
  world: WorldState,
  player: PlayerState,
  room: RoomState,
): { figure: FigureState; distance: number } | null {
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
): VerbOption[] {
  return availableVerbs({
    figureId: figure.id,
    fate: fateOf(world, figure.id),
    leverage: leverageOn(world, figure.id),
    lethalMeans: lethalMeansIn(room),
    leading: whoIsLed(world),
    roomKind: room.kind,
  });
}

export function findTarget(
  world: WorldState,
  room: RoomState,
  player: PlayerState,
): InteractTarget | null {
  // A door that just turned us away outranks everything: the player pressed into it on
  // purpose, and saying why is more useful than offering to look at a nearby chair.
  if (player.refusedDoorId) {
    const door = world.doorById.get(player.refusedDoorId);
    if (door) {
      return {
        kind: "door",
        doorId: door.id,
        prompt: doorRefusal(door),
      };
    }
  }

  const figure = nearestFigure(world, player, room);
  const local = toLocalPixels(room, player.x, player.y);
  const hotspot = findHotspot(
    reachableHotspots(world, room),
    local.x,
    local.y,
    room.tileSize,
  );

  const asFigure = (state: FigureState): InteractTarget => {
    const verbs = verbsFor(world, room, state);
    // One extra word on the prompt when there is anything else to do, rather than a
    // second HUD element. The key label is not spelled out here — `ui/controls.ts`
    // derives it from the binding, so rebinding does not lie.
    const more = verbs.some(
      (option) => option.verb !== "talk" && !option.refusal,
    );
    return {
      kind: "figure",
      figure: state,
      prompt: `заговорить с ${state.name}${more ? " · F — иначе" : ""}`,
      verbs,
    };
  };

  if (figure && hotspot) {
    const hotspotAway = hotspotDistance(hotspot, player, room);
    if (hotspotAway < figure.distance) {
      return { kind: "hotspot", hotspot, prompt: hotspot.prompt };
    }
    return asFigure(figure.figure);
  }
  if (figure) return asFigure(figure.figure);
  if (hotspot) return { kind: "hotspot", hotspot, prompt: hotspot.prompt };
  return null;
}
