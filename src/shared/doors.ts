/**
 * How wide a gate is, and which tiles it covers.
 *
 * This used to exist twice — once in the generator and once in the player — with a comment
 * on each asking whoever touched one to keep the other in step. That is not a contract, it
 * is a trap, and widening a doorway from three tiles to nine would have sprung it: the
 * generator would have drawn a nine-tile gate and the runtime would have indexed three of
 * them, leaving six tiles that looked like a door and behaved like scenery.
 *
 * So it lives here, once, and both sides import it.
 */

import type { Door } from "./dream";

/**
 * Tiles across. A route is a band you walk along rather than a corridor you file through,
 * so its gate spans the whole width — a nine-tile road with a three-tile gate in it would
 * be a wall with a hole, which is a dungeon idea.
 */
export const DOOR_SPAN = 9;

const HALF = (DOOR_SPAN - 1) / 2;

/** Every tile a gate occupies. Derived from its centre, so it cannot drift out of step. */
export function doorSpan(door: Door): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = -HALF; i <= HALF; i++) {
    out.push(
      door.orientation === "h"
        ? { x: door.x + i, y: door.y }
        : { x: door.x, y: door.y + i },
    );
  }
  return out;
}
