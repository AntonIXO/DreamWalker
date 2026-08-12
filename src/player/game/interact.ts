/**
 * Standing close enough to speak, and poking at things that are not people.
 *
 * §3 splits the game's two channels and prices them differently:
 *
 *   the world  — slow, safe, gives you crumbs. Things do not suspect you.
 *   people     — fast, dangerous, gives you pieces.
 *
 * Both come through here, and the difference is entirely in what they cost, which is
 * why the low-risk channel has to exist at all: without it the player is squeezed
 * between asking nothing and being found out.
 */

import { Tile } from "../../shared/tilecodes";
import {
  doorAtTile,
  doorRefusal,
  tileAt,
  type FigureState,
  type WorldState,
} from "./world";
import type { PlayerState } from "./player";

/** How close you have to stand. Just over one tile, so you must mean it. */
const REACH = 20;

export type InteractTarget =
  | { kind: "figure"; figure: FigureState; prompt: string }
  | { kind: "world"; x: number; y: number; prompt: string }
  | { kind: "door"; doorId: string; prompt: string };

export function findTarget(
  world: WorldState,
  player: PlayerState,
): InteractTarget | null {
  const size = world.tileSize;

  let nearest: FigureState | null = null;
  let nearestDistance = REACH;
  for (const figure of world.figures) {
    const fx = figure.x * size + size / 2;
    const fy = figure.y * size + size / 2;
    const distance = Math.hypot(fx - player.x, fy - player.y);
    if (distance < nearestDistance) {
      nearest = figure;
      nearestDistance = distance;
    }
  }
  if (nearest) {
    return {
      kind: "figure",
      figure: nearest,
      prompt: `${nearest.name} — заговорить`,
    };
  }

  // Whatever is directly in front, one tile along the way you are facing.
  const ahead = {
    n: { x: 0, y: -1 },
    s: { x: 0, y: 1 },
    e: { x: 1, y: 0 },
    w: { x: -1, y: 0 },
  }[player.facing];

  const tx = Math.floor(player.x / size) + ahead.x;
  const ty = Math.floor(player.y / size) + ahead.y;

  const door = doorAtTile(world, tx, ty);
  if (door) return { kind: "door", doorId: door.id, prompt: doorRefusal(door) };

  const tile = tileAt(world, tx, ty);
  if (tile === Tile.PROP || tile === Tile.PROP_SOLID) {
    return { kind: "world", x: tx, y: ty, prompt: "посмотреть" };
  }

  return null;
}

/**
 * Poking at the world. Cheap, safe, and mostly disappointing — which is the point:
 * §3 wants a channel that never raises suspicion, so it must not be a way to win.
 */
const WORLD_LINES = [
  "Ничего. Пыль и та ненастоящая.",
  "Кто-то это уже трогал. Недавно.",
  "Под этим — пол. Просто пол.",
  "Слишком аккуратно лежит для этой комнаты.",
  "Здесь чего-то не хватает, и непонятно чего.",
  "Ты уверен, что это было тут в прошлый раз?",
];

export function examine(world: WorldState, x: number, y: number): string {
  // Stable per tile, so re-examining the same thing does not reroll into new fiction.
  const hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  void world;
  return WORLD_LINES[hash % WORLD_LINES.length]!;
}
