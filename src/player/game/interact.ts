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
import type { RoomHotspot } from "../../shared/room";
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
  | { kind: "figure"; figure: FigureState; prompt: string }
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
    const distance = Math.hypot(
      figure.x * room.tileSize - player.x,
      figure.y * room.tileSize - player.y,
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
  tileSize: number,
): number {
  return Math.hypot(
    hotspot.x * tileSize - player.x,
    hotspot.y * tileSize - player.y,
  );
}

/** Every hotspot in the room right now: authored ones plus whatever the sleeper added. */
export function reachableHotspots(
  world: WorldState,
  room: RoomState,
): RoomHotspot[] {
  return [...liveHotspots(room), ...interestHotspots(world, room.id)];
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
  const hotspot = findHotspot(
    reachableHotspots(world, room),
    player.x,
    player.y,
    room.tileSize,
  );

  if (figure && hotspot) {
    const hotspotAway = hotspotDistance(hotspot, player, room.tileSize);
    if (hotspotAway < figure.distance) {
      return { kind: "hotspot", hotspot, prompt: hotspot.prompt };
    }
    return {
      kind: "figure",
      figure: figure.figure,
      prompt: `заговорить с ${figure.figure.name}`,
    };
  }
  if (figure) {
    return {
      kind: "figure",
      figure: figure.figure,
      prompt: `заговорить с ${figure.figure.name}`,
    };
  }
  if (hotspot) return { kind: "hotspot", hotspot, prompt: hotspot.prompt };
  return null;
}
