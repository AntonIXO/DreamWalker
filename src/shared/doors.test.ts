import { describe, expect, test } from "bun:test";

import {
  punchDoorThresholds,
  doorHasWalkableCell,
  doorIsUsable,
  settleDoor,
} from "./doors";
import { cellAt } from "./roomGrid";
import type { RoomDoor } from "./room";

function door(over: Partial<RoomDoor> & { id: string }): RoomDoor {
  return {
    x: 1,
    y: 1,
    w: 1,
    h: 1,
    toRoomId: "x",
    toEntryId: null,
    type: "open",
    threshold: "door",
    levelDelta: 0,
    facing: null,
    toFigureId: null,
    keyId: null,
    prompt: null,
    ...over,
  };
}

function box(doors: RoomDoor[]) {
  return {
    width: 20,
    height: 11,
    cells: [
      "####################",
      "#==================#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "####################",
    ],
    doors,
  };
}

/**
 * A floor with an interior wall across the middle and a gap in it. This is the shape the
 * old `y <= 1 || y >= height - 1` rule could not describe: a wall that is not the ring.
 */
function partitioned(doors: RoomDoor[]) {
  return {
    width: 20,
    height: 11,
    cells: [
      "####################",
      "#==================#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#########==#########",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "####################",
    ],
    doors,
  };
}

describe("punchDoorThresholds", () => {
  test("keeps a wall-face hub door on the wall so the floor stays walkable", () => {
    const opened = punchDoorThresholds(
      box([door({ id: "hub--to-x", x: 3, y: 1 })]),
    );
    expect(opened.doors[0]!.y).toBe(1);
    expect(doorHasWalkableCell(opened, opened.doors[0]!)).toBe(false);
    expect(cellAt(opened, 3, 2)).toBe("floor");
  });

  test("does not stack two hub doors on the same tile", () => {
    const opened = punchDoorThresholds(
      box([door({ id: "a" }), door({ id: "b" })]),
    );
    expect(
      opened.doors[0]!.x === opened.doors[1]!.x &&
        opened.doors[0]!.y === opened.doors[1]!.y,
    ).toBe(false);
  });

  test("leaves a door set into an interior wall solid", () => {
    const opened = punchDoorThresholds(
      partitioned([door({ id: "gap", x: 9, y: 5, w: 2 })]),
    );
    expect(opened.doors[0]).toEqual(
      expect.objectContaining({ x: 9, y: 5, w: 2 }),
    );
    expect(cellAt(opened, 9, 5)).toBe("wallFace");
    expect(cellAt(opened, 10, 5)).toBe("wallFace");
  });

  test("punches a door standing on interior floor", () => {
    const opened = punchDoorThresholds(
      partitioned([door({ id: "mid", x: 4, y: 7, w: 2 })]),
    );
    expect(cellAt(opened, 4, 7)).toBe("threshold");
    expect(cellAt(opened, 5, 7)).toBe("threshold");
  });
});

describe("settleDoor", () => {
  test("leaves an authored, usable, non-overlapping door exactly where it was", () => {
    // The landmine: this door is on the wall ring, which the repair scan used to yank
    // to the first free column regardless of intent.
    const room = partitioned([]);
    const authored = door({ id: "gap", x: 14, y: 5, w: 2 });
    expect(settleDoor(room, authored, [])).toBe(authored);

    const onRing = door({ id: "front", x: 12, y: 1, w: 2 });
    expect(settleDoor(room, onRing, [])).toBe(onRing);
  });

  test("still repairs a door that nothing can reach", () => {
    const sealed = {
      width: 6,
      height: 5,
      cells: ["######", "######", "##..##", "######", "######"],
      doors: [],
    };
    const stranded = door({ id: "nowhere", x: 0, y: 0 });
    const settled = settleDoor(sealed, stranded, []);
    expect(settled).not.toBe(stranded);
  });
});

describe("doorIsUsable", () => {
  const room = partitioned([]);

  test("accepts a wall door approached from either side", () => {
    const gap = door({ id: "gap", x: 9, y: 5, w: 2 });
    expect(doorHasWalkableCell(room, gap)).toBe(false);
    expect(doorIsUsable(room, gap)).toBe(true);
    expect(doorIsUsable(room, gap, "n")).toBe(true);
    expect(doorIsUsable(room, gap, "s")).toBe(true);
  });

  test("honours an authored facing over the free-for-all", () => {
    // A door in the middle of the south ring: floor above, outside below.
    const bottom = door({ id: "bottom", x: 4, y: 10, w: 2 });
    expect(doorIsUsable(room, bottom, "n")).toBe(true);
    expect(doorIsUsable(room, bottom, "s")).toBe(false);
  });
});
