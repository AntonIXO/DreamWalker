import { describe, expect, test } from "bun:test";

import { LOBBY_DEFINITION } from "../player/lobby/definition";
import { blockedInRoom, cellAt, findHotspot } from "./roomGrid";
import { createWalker, updateWalker, walkFrame, WALK_SPEED } from "./roomWalk";

/**
 * A room the size of the smallest thing worth testing: a floor with one wall down
 * the middle of the right-hand side and one solid crate.
 */
const GRID = {
  width: 6,
  height: 4,
  cells: ["######", "#..#.#", "#....#", "######"],
} as const;

const CRATE = [{ x: 1, y: 2, w: 1, h: 1, solid: true }];
const RUG = [{ x: 1, y: 2, w: 1, h: 1, solid: false }];
const TILE = 16;

describe("cellAt", () => {
  test("reads the authoring alphabet", () => {
    expect(cellAt(GRID, 1, 1)).toBe("floor");
    expect(cellAt(GRID, 3, 1)).toBe("wall");
    expect(cellAt(LOBBY_DEFINITION, 9, 2)).toBe("floorAlt");
    expect(cellAt(LOBBY_DEFINITION, 7, 6)).toBe("threshold");
    expect(cellAt(LOBBY_DEFINITION, 0, 1)).toBe("wallFace");
  });

  test("anything off the grid is void, never floor", () => {
    expect(cellAt(GRID, -1, 1)).toBe("void");
    expect(cellAt(GRID, 99, 1)).toBe("void");
    expect(cellAt(GRID, 1, -1)).toBe("void");
    expect(cellAt(GRID, 1, 99)).toBe("void");
  });
});

describe("blockedInRoom", () => {
  const box = { x: 0, y: 0, width: 9, height: 7 };

  test("open floor is walkable", () => {
    expect(blockedInRoom(GRID, [], { ...box, x: 24, y: 40 }, TILE)).toBe(false);
  });

  test("a wall blocks", () => {
    expect(blockedInRoom(GRID, [], { ...box, x: 56, y: 24 }, TILE)).toBe(true);
  });

  test("a solid rect blocks and a non-solid one does not", () => {
    const onTheCrate = { ...box, x: 24, y: 40 };
    expect(blockedInRoom(GRID, CRATE, onTheCrate, TILE)).toBe(true);
    expect(blockedInRoom(GRID, RUG, onTheCrate, TILE)).toBe(false);
  });
});

describe("updateWalker", () => {
  const step = (axis: { x: number; y: number }, from = { x: 24, y: 40 }) => {
    const walker = createWalker(from.x, from.y);
    updateWalker(walker, GRID, [], TILE, axis, 0.1);
    return walker;
  };

  test("moves at WALK_SPEED and faces the way it went", () => {
    const walker = step({ x: 1, y: 0 });
    expect(walker.x).toBeCloseTo(24 + WALK_SPEED * 0.1, 5);
    expect(walker.y).toBe(40);
    expect(walker.facing).toBe("e");
    expect(walker.moving).toBe(true);
  });

  test("standing still is not moving, and keeps the old facing", () => {
    const walker = createWalker(24, 40, "w");
    updateWalker(walker, GRID, [], TILE, { x: 0, y: 0 }, 0.1);
    expect(walker.moving).toBe(false);
    expect(walker.facing).toBe("w");
    expect(walker.travelled).toBe(0);
  });

  test("a wall stops the axis into it but not the one along it", () => {
    // Row 1 is "#..#.#", so tile x=3 is wall; row 2 below it is open floor.
    // Standing at x=42 the body's right edge is one step from tile 3: pushing
    // south-east, the horizontal move is refused and the vertical one still lands.
    // That separation is what lets a walker slide along a wall instead of sticking.
    const walker = createWalker(42, 24);
    updateWalker(walker, GRID, [], TILE, { x: 1, y: 1 }, 0.1);
    expect(walker.x).toBe(42);
    expect(walker.y).toBeGreaterThan(24);
  });

  test("horizontal wins a diagonal tie, so the walker reads in profile", () => {
    expect(step({ x: 1, y: 1 }).facing).toBe("e");
    expect(step({ x: -1, y: 1 }).facing).toBe("w");
    expect(step({ x: 0, y: 1 }).facing).toBe("s");
    expect(step({ x: 0, y: -1 }).facing).toBe("n");
  });
});

describe("walkFrame", () => {
  test("standing still is always frame 0", () => {
    const walker = createWalker(0, 0);
    walker.travelled = 999;
    walker.moving = false;
    expect(walkFrame(walker)).toBe(0);
  });

  test("alternates two frames by distance travelled, not by time", () => {
    const walker = createWalker(0, 0);
    walker.moving = true;
    walker.travelled = 0;
    expect(walkFrame(walker)).toBe(0);
    walker.travelled = 9;
    expect(walkFrame(walker)).toBe(1);
    walker.travelled = 18;
    expect(walkFrame(walker)).toBe(0);
  });
});

describe("findHotspot", () => {
  const spots = [
    { id: "far", x: 10, y: 10, reach: 1 },
    { id: "near", x: 2, y: 2, reach: 2 },
    { id: "nearer", x: 1.6, y: 2, reach: 2 },
  ];

  test("returns the nearest hotspot within its own reach", () => {
    expect(findHotspot(spots, 1.6 * TILE, 2 * TILE, TILE)?.id).toBe("nearer");
  });

  test("returns null when nothing is in reach", () => {
    expect(findHotspot(spots, 6 * TILE, 6 * TILE, TILE)).toBeNull();
  });

  test("reach is per-hotspot, not global", () => {
    // 1.5 tiles from "far", whose reach is only 1 — out of range despite proximity.
    expect(findHotspot([spots[0]!], 11.5 * TILE, 10 * TILE, TILE)).toBeNull();
    expect(findHotspot([spots[1]!], 3.5 * TILE, 2 * TILE, TILE)?.id).toBe(
      "near",
    );
  });
});

describe("the lobby still walks the way it did", () => {
  const spawn = LOBBY_DEFINITION.spawn;
  const size = LOBBY_DEFINITION.tileSize;

  test("spawns on something walkable", () => {
    const walker = createWalker(spawn.x * size, spawn.y * size, spawn.facing);
    expect(
      blockedInRoom(
        LOBBY_DEFINITION,
        LOBBY_DEFINITION.furniture,
        { x: walker.x, y: walker.y, width: 9, height: 7 },
        size,
      ),
    ).toBe(false);
  });

  test("walks west across open floor from the spawn", () => {
    const walker = createWalker(spawn.x * size, spawn.y * size, spawn.facing);
    for (let i = 0; i < 30; i++) {
      updateWalker(
        walker,
        LOBBY_DEFINITION,
        LOBBY_DEFINITION.furniture,
        size,
        { x: -1, y: 0 },
        1 / 60,
      );
    }
    expect(walker.x).toBeLessThan(spawn.x * size);
    expect(walker.facing).toBe("w");
  });

  test("the mural's visible furniture is solid and its open floor is not", () => {
    const blockedTiles = [
      [1, 3], // roots and capybara cabinet
      [17, 4], // printer feeding the drain
      [15, 10], // meat pedestal, dome bin and sofa
      [2, 8], // bed
      [6, 8], // patient apparatus
    ] as const;
    const openTiles = [
      [8, 4],
      [13, 5],
      [13, 10],
    ] as const;
    const at = (x: number, y: number) =>
      blockedInRoom(
        LOBBY_DEFINITION,
        LOBBY_DEFINITION.furniture,
        {
          x: (x + 0.5) * size,
          y: (y + 0.5) * size,
          width: 9,
          height: 7,
        },
        size,
      );

    for (const [x, y] of blockedTiles) expect(at(x, y)).toBe(true);
    for (const [x, y] of openTiles) expect(at(x, y)).toBe(false);
  });

  test("cannot walk out through the north wall", () => {
    const walker = createWalker(spawn.x * size, spawn.y * size, spawn.facing);
    for (let i = 0; i < 600; i++) {
      updateWalker(
        walker,
        LOBBY_DEFINITION,
        LOBBY_DEFINITION.furniture,
        size,
        { x: 0, y: -1 },
        1 / 60,
      );
    }
    // Row 0 is "#", row 1 is "=" — both solid, so the body never reaches tile row 2.
    expect(walker.y).toBeGreaterThan(2 * size - size);
  });

  test("every authored hotspot is reachable from the connected open floor", () => {
    const key = (x: number, y: number) => `${x}:${y}`;
    const standable = (x: number, y: number) =>
      !blockedInRoom(
        LOBBY_DEFINITION,
        LOBBY_DEFINITION.furniture,
        {
          x: (x + 0.5) * size,
          y: (y + 0.5) * size,
          width: 9,
          height: 7,
        },
        size,
      );
    const start = { x: Math.floor(spawn.x), y: Math.floor(spawn.y) };
    const queue = [start];
    const reached = new Set([key(start.x, start.y)]);
    while (queue.length > 0) {
      const here = queue.shift()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const x = here.x + dx;
        const y = here.y + dy;
        const next = key(x, y);
        if (reached.has(next) || !standable(x, y)) continue;
        reached.add(next);
        queue.push({ x, y });
      }
    }

    for (const hotspot of LOBBY_DEFINITION.hotspots) {
      const approachable = [...reached].some((cell) => {
        const [x, y] = cell.split(":").map(Number) as [number, number];
        return (
          Math.hypot(x + 0.5 - hotspot.x, y + 0.5 - hotspot.y) <= hotspot.reach
        );
      });
      expect(approachable, `${hotspot.id} needs a standable approach`).toBe(
        true,
      );
    }
  });
});
