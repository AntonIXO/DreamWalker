import { describe, expect, test } from "bun:test";

import { punchDoorThresholds, doorHasWalkableCell } from "./doors";
import { cellAt } from "./roomGrid";
import type { RoomDoor } from "./room";

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

describe("punchDoorThresholds", () => {
  test("keeps a wall-face hub door on the wall so the floor stays walkable", () => {
    const opened = punchDoorThresholds(
      box([
        {
          id: "hub--to-x",
          x: 3,
          y: 1,
          w: 1,
          h: 1,
          toRoomId: "x",
          toEntryId: "default",
          type: "open",
          keyId: null,
          prompt: null,
        },
      ]),
    );
    expect(opened.doors[0]!.y).toBe(1);
    expect(doorHasWalkableCell(opened, opened.doors[0]!)).toBe(false);
    expect(cellAt(opened, 3, 2)).toBe("floor");
  });

  test("does not stack two hub doors on the same tile", () => {
    const opened = punchDoorThresholds(
      box([
        {
          id: "a",
          x: 1,
          y: 1,
          w: 1,
          h: 1,
          toRoomId: "a",
          toEntryId: null,
          type: "open",
          keyId: null,
          prompt: null,
        },
        {
          id: "b",
          x: 1,
          y: 1,
          w: 1,
          h: 1,
          toRoomId: "b",
          toEntryId: null,
          type: "open",
          keyId: null,
          prompt: null,
        },
      ]),
    );
    expect(
      opened.doors[0]!.x === opened.doors[1]!.x &&
        opened.doors[0]!.y === opened.doors[1]!.y,
    ).toBe(false);
  });
});
