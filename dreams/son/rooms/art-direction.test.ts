import { expect, test } from "bun:test";
import { allRooms } from "./catalog";
import {
  blockedInRoom,
  cellAt,
  isWalkableCell,
} from "../../../src/shared/roomGrid";
import { imageFrame } from "../../../src/shared/art/frame";
import { isContinuousDoor } from "../../../src/shared/street";
import { rectsOverlap } from "../../../src/shared/rect";

test("every bent connector has connected, body-wide arrivals and continuous door seams", () => {
  const rooms = allRooms();
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const routes = rooms.filter((room) => room.id.startsWith("path-"));
  expect(
    new Set(routes.map((room) => `${room.width}x${room.height}`)).size,
  ).toBeGreaterThan(6);
  for (const room of routes) {
    const first = room.entries[0]!;
    const visited = new Set<string>();
    const queue = [[Math.floor(first.x), Math.floor(first.y)]];
    for (let i = 0; i < queue.length; i++) {
      const [x, y] = queue[i]! as [number, number];
      const key = `${x},${y}`;
      if (visited.has(key) || !isWalkableCell(cellAt(room, x, y))) continue;
      visited.add(key);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ])
        queue.push([x + dx!, y + dy!]);
    }
    for (const entry of room.entries) {
      expect(visited.has(`${Math.floor(entry.x)},${Math.floor(entry.y)}`)).toBe(
        true,
      );
      expect(
        blockedInRoom(
          room,
          room.props,
          { x: entry.x * 16, y: entry.y * 16, width: 9, height: 7 },
          16,
        ),
      ).toBe(false);
    }
    for (const door of room.doors)
      expect(isContinuousDoor(room, door, byId.get(door.toRoomId))).toBe(true);
  }
});

test("shaped rooms cut real solid exterior corners and furniture never blocks a threshold", () => {
  const rooms = allRooms().filter((room) =>
    room.tags.some((tag) => tag.startsWith("architecture:")),
  );
  expect(rooms).toHaveLength(16);
  for (const room of rooms) {
    expect(room.cells.some((row) => row.includes(" "))).toBe(true);
    expect(imageFrame(room.graphics.backdropImage!)).not.toBeNull();
    for (const entry of room.entries) {
      expect(
        blockedInRoom(
          room,
          room.props,
          {
            x: entry.x * room.tileSize,
            y: entry.y * room.tileSize,
            width: 9,
            height: 7,
          },
          room.tileSize,
        ),
      ).toBe(false);
    }
    for (const prop of room.props.filter(
      (prop) => prop.id.startsWith("style-") && prop.solid,
    )) {
      expect(room.doors.some((door) => rectsOverlap(prop, door))).toBe(false);
      for (const slot of room.figureSlots)
        expect(
          slot.x >= prop.x &&
            slot.x < prop.x + prop.w &&
            slot.y >= prop.y &&
            slot.y < prop.y + prop.h,
        ).toBe(false);
    }
  }
});
