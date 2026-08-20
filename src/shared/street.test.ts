import { describe, expect, test } from "bun:test";

import type { RoomDoor } from "./room";
import { BODY_HEIGHT, BODY_WIDTH } from "./roomGrid";
import { blockedInWorld, isEdgeOpening, type PlacedRoom } from "./street";

function door(
  over: Partial<RoomDoor> & { id: string; toRoomId: string },
): RoomDoor {
  return {
    x: 1,
    y: 10,
    w: 18,
    h: 1,
    toEntryId: "from-n",
    type: "open",
    threshold: "door",
    levelDelta: 0,
    facing: "n",
    toFigureId: null,
    keyId: null,
    prompt: null,
    ...over,
  };
}

function room(over: Partial<PlacedRoom> & { id: string }): PlacedRoom {
  return {
    width: 20,
    height: 11,
    tileSize: 16,
    originX: 0,
    originY: 0,
    cells: [
      "#__________________#",
      "#__________________#",
      "_.................._",
      "_.................._",
      "_.................._",
      "_.................._",
      "_.................._",
      "_.................._",
      "_.................._",
      "_.................._",
      "####################",
    ],
    props: [],
    doors: [],
    ...over,
  };
}

describe("isEdgeOpening", () => {
  test("a south-wall door onto the next room is an opening", () => {
    const north = room({
      id: "apartment",
      doors: [door({ id: "south", toRoomId: "dacha" })],
    });
    const south = room({
      id: "dacha",
      originY: 11,
      doors: [
        door({
          id: "north",
          y: 0,
          h: 2,
          toRoomId: "apartment",
          facing: "s",
        }),
      ],
    });
    expect(isEdgeOpening([north, south], north, 10, 10)).toBe(true);
    expect(isEdgeOpening([north, south], north, 0, 10)).toBe(false);
  });
});

describe("blockedInWorld", () => {
  test("walking into a painted south doorway is not a wall", () => {
    const north = room({
      id: "apartment",
      doors: [door({ id: "south", toRoomId: "dacha" })],
    });
    const south = room({
      id: "dacha",
      originY: 11,
      doors: [
        door({
          id: "north",
          y: 0,
          h: 2,
          toRoomId: "apartment",
          facing: "s",
        }),
      ],
    });
    const size = 16;
    const box = {
      x: 10 * size + size / 2,
      y: 10 * size + 2,
      width: BODY_WIDTH,
      height: BODY_HEIGHT,
    };
    expect(blockedInWorld([north, south], "apartment", box, size)).toBe(false);
  });

  test("a wall that is not a street door still blocks", () => {
    const north = room({
      id: "apartment",
      doors: [door({ id: "south", toRoomId: "dacha" })],
    });
    const south = room({
      id: "dacha",
      originY: 11,
      doors: [],
    });
    const size = 16;
    const box = {
      x: size / 2,
      y: 10 * size + 2,
      width: BODY_WIDTH,
      height: BODY_HEIGHT,
    };
    expect(blockedInWorld([north, south], "apartment", box, size)).toBe(true);
  });
});
