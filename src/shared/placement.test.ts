import { describe, expect, test } from "bun:test";

import {
  approachTile,
  entryRegion,
  freeSlots,
  overlappingProps,
  rectIsReachable,
  settleObject,
  slotIsUsable,
  standable,
  walkableRegions,
} from "./placement";
import type { PlacementHost } from "./placement";
import type { SolidRect } from "./roomGrid";

/**
 * A room with a walled-off closet in the top right. The closet floor is perfectly
 * walkable and completely unreachable, which is the bug an ASCII editor cannot show you.
 */
const CLOSET: PlacementHost = {
  width: 12,
  height: 8,
  cells: [
    "############",
    "#=========##",
    "#.......##.#",
    "#.......##.#",
    "#.......##.#",
    "#.......##.#",
    "#.......##.#",
    "############",
  ],
  props: [],
  doors: [],
  entries: [{ x: 2, y: 6 }],
};

function host(over: Partial<PlacementHost> = {}): PlacementHost {
  return {
    width: 12,
    height: 8,
    cells: [
      "############",
      "#==========#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#..........#",
      "#..........#",
      "############",
    ],
    props: [],
    doors: [],
    entries: [{ x: 6, y: 6 }],
    ...over,
  };
}

function prop(over: Partial<SolidRect> & { id: string }) {
  return { x: 2, y: 2, w: 2, h: 2, solid: true, ...over };
}

describe("standable", () => {
  test("refuses walls, the outside, and anything solid standing on floor", () => {
    const room = host({ props: [prop({ id: "counter", x: 4, y: 3 })] });
    expect(standable(room, 0, 0)).toBe(false);
    expect(standable(room, 99, 3)).toBe(false);
    expect(standable(room, 3, 3)).toBe(true);
    expect(standable(room, 4, 3)).toBe(false);
    expect(standable(room, 5, 4)).toBe(false);
    expect(standable(room, 6, 3)).toBe(true);
  });
});

describe("walkableRegions", () => {
  test("a sealed closet is its own region, and it is not the room's", () => {
    const regions = walkableRegions(CLOSET);
    const at = (x: number, y: number): number => regions[y * CLOSET.width + x]!;
    expect(at(2, 6)).not.toBe(-1);
    expect(at(10, 3)).not.toBe(-1);
    expect(at(10, 3)).not.toBe(at(2, 6));
  });

  test("a solid prop across a corridor cuts it in two", () => {
    const room = host({
      // A wall of furniture from the north wall to the south wall.
      props: [prop({ id: "shelves", x: 6, y: 2, w: 1, h: 5 })],
    });
    const regions = walkableRegions(room);
    const at = (x: number, y: number): number => regions[y * room.width + x]!;
    expect(at(3, 4)).not.toBe(at(9, 4));
  });

  test("a diagonal-only gap does not connect, because the walker cannot use it", () => {
    const room = host({
      props: [
        prop({ id: "a", x: 6, y: 2, w: 1, h: 2 }),
        prop({ id: "b", x: 5, y: 4, w: 1, h: 3 }),
      ],
    });
    const regions = walkableRegions(room);
    const at = (x: number, y: number): number => regions[y * room.width + x]!;
    // (6,4) and (5,3) touch only at a corner.
    expect(at(9, 6)).not.toBe(at(2, 6));
  });
});

describe("entryRegion", () => {
  test("holds the room and not the closet", () => {
    const region = entryRegion(CLOSET);
    expect(region.has(6 * CLOSET.width + 2)).toBe(true);
    expect(region.has(3 * CLOSET.width + 10)).toBe(false);
  });
});

describe("slotIsUsable", () => {
  const room = host({ props: [prop({ id: "counter", x: 4, y: 3 })] });
  const region = entryRegion(room);

  test("refuses a slot inside furniture", () => {
    expect(slotIsUsable(room, { id: "s", x: 4, y: 3 }, region)).toBe(false);
  });

  test("refuses a slot in a pocket nothing can reach", () => {
    expect(
      slotIsUsable(CLOSET, { id: "s", x: 10, y: 3 }, entryRegion(CLOSET)),
    ).toBe(false);
  });

  test("refuses a stated approach that is not walkable", () => {
    // North of (3,2) is the wall face at y=1.
    expect(
      slotIsUsable(room, { id: "s", x: 3, y: 2, facing: "n" }, region),
    ).toBe(false);
    expect(
      slotIsUsable(room, { id: "s", x: 3, y: 2, facing: "s" }, region),
    ).toBe(true);
  });
});

describe("rectIsReachable", () => {
  test("an object walled in on every side cannot be examined", () => {
    const room = host({
      props: [prop({ id: "ring", x: 3, y: 3, w: 3, h: 3 })],
    });
    // The middle tile of the ring is enclosed by its own prop.
    expect(rectIsReachable(room, { x: 4, y: 4, w: 1, h: 1 })).toBe(false);
    expect(rectIsReachable(room, { x: 3, y: 3, w: 3, h: 3 })).toBe(true);
  });

  test("honours a stated side", () => {
    const room = host();
    const table = { x: 4, y: 2, w: 2, h: 1 };
    expect(rectIsReachable(room, table, "s")).toBe(true);
    expect(rectIsReachable(room, table, "n")).toBe(false);
  });
});

describe("settleObject", () => {
  test("leaves a legal authored placement exactly where it was", () => {
    const room = host();
    const authored = prop({ id: "bench", x: 7, y: 4 });
    expect(settleObject(room, authored, [authored])).toBe(authored);
  });

  test("moves a thing nobody can walk up to", () => {
    // The closet is walkable and sealed. A thing in there is furniture in a photograph.
    const stranded = prop({ id: "stranded", x: 10, y: 3, w: 1, h: 1 });
    const settled = settleObject(CLOSET, stranded, [stranded]);
    expect(settled).not.toBe(stranded);
    expect(rectIsReachable(CLOSET, settled, null, entryRegion(CLOSET))).toBe(
      true,
    );
  });

  test("does not police the mask — a shelf set into a wall is a shelf", () => {
    // Whether an object belongs on floor, on a wall or on a table is a property of the
    // object (`wants`), not of `settleObject`. All this pass owns is: in bounds, off the
    // doors and entries, off other furniture, and reachable from somewhere.
    const room = host();
    const shelf = prop({ id: "shelf", x: 4, y: 1, w: 2, h: 1 });
    expect(settleObject(room, shelf, [shelf])).toBe(shelf);
  });

  test("moves a thing off a door and off an entry", () => {
    const room = host({ doors: [{ x: 2, y: 2, w: 2, h: 1 }] });
    const onDoor = settleObject(
      room,
      prop({ id: "d", x: 2, y: 2, w: 1, h: 1 }),
      [],
    );
    expect(onDoor.x === 2 && onDoor.y === 2).toBe(false);

    const onEntry = settleObject(
      room,
      prop({ id: "e", x: 6, y: 6, w: 1, h: 1 }),
      [],
    );
    expect(onEntry.x === 6 && onEntry.y === 6).toBe(false);
  });
});

describe("overlappingProps", () => {
  test("reports a solid pair and ignores two decorations", () => {
    expect(
      overlappingProps([
        prop({ id: "a", x: 2, y: 2 }),
        prop({ id: "b", x: 3, y: 3 }),
        prop({ id: "far", x: 8, y: 2 }),
      ]),
    ).toEqual([["a", "b"]]);

    expect(
      overlappingProps([
        prop({ id: "rug", x: 2, y: 2, solid: false }),
        prop({ id: "stain", x: 3, y: 3, solid: false }),
      ]),
    ).toEqual([]);
  });
});

describe("freeSlots", () => {
  test("drops what is taken and what nothing could use", () => {
    const room = host({ props: [prop({ id: "counter", x: 4, y: 3 })] });
    const slots = [
      { id: "a", x: 2, y: 4 },
      { id: "b", x: 4, y: 3 },
      { id: "c", x: 8, y: 4 },
    ];
    expect(
      freeSlots(room, slots, new Set(["c"])).map((slot) => slot.id),
    ).toEqual(["a"]);
  });
});

describe("approachTile", () => {
  test("steps one tile off in the named direction", () => {
    expect(approachTile({ x: 4.5, y: 3 }, "n")).toEqual({ x: 4, y: 2 });
    expect(approachTile({ x: 4.5, y: 3 }, "e")).toEqual({ x: 5, y: 3 });
  });
});
