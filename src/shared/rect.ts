/**
 * Tile rectangles.
 *
 * Three files needed the same six-line overlap test and each grew its own copy:
 * `doors.ts` had it private, `roomGrid.ts` inlined it inside `rectBlocks`, and the
 * heartbeat is about to need it to decide whether a patch touches what is on screen.
 * One copy, so a fix to the half-open convention below reaches all three.
 *
 * Every rect here is half-open in both axes — `x` is inside, `x + w` is not — which is
 * what makes two rects that merely touch along an edge count as separate.
 *
 * Must stay free of DOM *and* node APIs.
 */

export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function rectsOverlap(a: TileRect, b: TileRect): boolean {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}

export function rectContainsPoint(
  rect: TileRect,
  x: number,
  y: number,
): boolean {
  return (
    x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
  );
}

/** Grow a rect by `by` tiles on every side. Used to give a patch a little margin. */
export function padRect(rect: TileRect, by: number): TileRect {
  return {
    x: rect.x - by,
    y: rect.y - by,
    w: rect.w + by * 2,
    h: rect.h + by * 2,
  };
}
