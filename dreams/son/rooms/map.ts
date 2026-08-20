/**
 * A Pokémon-style map: places stay places, and you walk a road to the next one.
 *
 * Authored rooms keep their walls and their painting. A two-tile doorway opens onto a
 * route — grass, a dirt path, a tree line — that actually occupies the gap between
 * buildings. Walking east out of the courtyard is walking a street until the hotel
 * door, not a cut and not two paintings glued on a seam.
 */

import type { Direction } from "../../../src/shared/roomGrid";
import { setCellMark } from "../../../src/shared/roomGrid";
import type { DreamRoom, RoomDoor, RoomEntry } from "../../../src/shared/room";
import { cloneRoom } from "./box";

export type StreetDir = Direction;

interface Cell {
  x: number;
  y: number;
}

const OPPOSITE: Record<StreetDir, StreetDir> = {
  n: "s",
  e: "w",
  s: "n",
  w: "e",
};

const STEP: Record<StreetDir, Cell> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

const APPROACH: Record<StreetDir, StreetDir> = {
  n: "s",
  e: "w",
  s: "n",
  w: "e",
};

/** Authored rooms are 20×11. Routes occupy the leftover strip between them. */
export const PLACE_W = 20;
export const PLACE_H = 11;
export const ROAD_W = 14;
export const ROAD_H = 10;
export const STRIDE_X = PLACE_W + ROAD_W;
export const STRIDE_Y = PLACE_H + ROAD_H;
const DOOR_X = 9;
const DOOR_Y = 5;
const DOOR_SPAN = 2;

/**
 * Grid: +x is east, +y is south. The courtyard is the block you spawn on.
 *
 * Extra catalogue rooms (m5–m12, the 5854 den) occupy cells that become holes in the
 * published 29-room artifact; those holes grow into woods so the camera never pans
 * onto void.
 */
export const STREET_CELLS: Readonly<Record<string, Cell>> = {
  "m3-sklad-ostavlennogo": { x: 0, y: 0 },
  "15-osennii-les-s-grobom": { x: 1, y: 0 },
  "03-gory-startapery-i-uchenye": { x: 2, y: 0 },
  "16-norvezhskaia-derevnia-i-pogreb": { x: 3, y: 0 },
  "18-kupol-bez-sten": { x: 4, y: 0 },
  "m2-miasnaia-geometriia": { x: 5, y: 0 },
  "m11-zamok-po-vremeni": { x: 6, y: 0 },

  "14-poliklinika-v-kaluge": { x: 0, y: 1 },
  "02-shkola-kabinet-russkogo": { x: 1, y: 1 },
  "09-hakaton-tretii-po-schetu": { x: 2, y: 1 },
  "20-ofis-sbera": { x: 3, y: 1 },
  "13-podzemnye-zaly-cu": { x: 4, y: 1 },
  "12-tiurma-na-ovoschah": { x: 5, y: 1 },
  "10-komnata-s-grobami": { x: 6, y: 1 },

  "05-shesterochka": { x: 0, y: 2 },
  "19-dvor-i-oranzhevye-lavochki": { x: 1, y: 2 },
  "01-otel-goticheskii-holl": { x: 2, y: 2 },
  "11-evreiskii-gorod": { x: 3, y: 2 },
  "25-metro-i-poezd-kotoryi-ne-tot": { x: 4, y: 2 },
  "22-kreiser": { x: 5, y: 2 },
  "23-nigeriia-konferenciia": { x: 6, y: 2 },

  "06-kanava-garazhi-podvorotni": { x: 0, y: 3 },
  "08-kvartira-v-kotoroi-zhivut-drugie": { x: 1, y: 3 },
  "17-dush-iz-kotorogo-nelzia-vyiti": { x: 2, y: 3 },
  "21-komnata-niliufar": { x: 3, y: 3 },
  "24-dom-gde-tebe-obiasniaiut-chto-ty-dolzhen": { x: 4, y: 3 },
  "m10-zamorozhennaia-morkovka": { x: 5, y: 3 },
  "m12-nedoliudi": { x: 6, y: 3 },

  "m1-korni": { x: 0, y: 4 },
  "04-dacha-gnedkovyh": { x: 1, y: 4 },
  "m4-razvilka-gde-ty-ostalsia": { x: 2, y: 4 },
  "m5-odinochestvo": { x: 3, y: 4 },
  "m6-krugi-vokrug-pruda": { x: 4, y: 4 },
  "m7-rm-rf": { x: 5, y: 4 },
  "m8-5854": { x: 6, y: 4 },

  "m9-shkaf": { x: 2, y: 5 },
  "m8-den": { x: 6, y: 5 },
};

const HOTEL = "01-otel-goticheskii-holl";
const POOL = "07-bassein-i-odnostoronnii-lift";

const WILD = /^(03-|06-|10-|15-|16-|18-|m1-|m2-|m4-|m5-|m6-|m9-|m10-|m11-)/;

export function isGeneratedRoom(id: string): boolean {
  return /^(path|gap|woods)-/.test(id);
}

function isPuzzleDoor(door: RoomDoor): boolean {
  return /^m8-5854--day-\d+$/.test(door.id);
}

function restoreRing(room: DreamRoom): void {
  const cells = room.cells.map((row) => row.split(""));
  for (let y = 0; y < room.height; y++) {
    const row = cells[y];
    if (!row) continue;
    for (let x = 0; x < room.width; x++) {
      const onRing =
        y === 0 || y === room.height - 1 || x === 0 || x === room.width - 1;
      const wallFace = y === 1 && x > 0 && x < room.width - 1;
      if (onRing) row[x] = "#";
      else if (wallFace) row[x] = "=";
      else if (row[x] === "_") row[x] = ".";
    }
    cells[y] = row;
  }
  room.cells = cells.map((row) => row.join(""));
}

function doorway(
  room: DreamRoom,
  dir: StreetDir,
): { x: number; y: number; w: number; h: number } {
  if (dir === "n") return { x: DOOR_X, y: 0, w: DOOR_SPAN, h: 2 };
  if (dir === "s") {
    return { x: DOOR_X, y: room.height - 1, w: DOOR_SPAN, h: 1 };
  }
  if (dir === "w") return { x: 0, y: DOOR_Y, w: 1, h: DOOR_SPAN };
  return { x: room.width - 1, y: DOOR_Y, w: 1, h: DOOR_SPAN };
}

function entryFor(room: DreamRoom, dir: StreetDir): RoomEntry {
  const midX = DOOR_X + 1;
  const midY = DOOR_Y + 1;
  if (dir === "n") return { id: "from-n", x: midX, y: 2.3, facing: "s" };
  if (dir === "s") {
    return { id: "from-s", x: midX, y: room.height - 2.3, facing: "n" };
  }
  if (dir === "w") return { id: "from-w", x: 1.5, y: midY, facing: "e" };
  return { id: "from-e", x: room.width - 1.5, y: midY, facing: "w" };
}

function ensureEntry(room: DreamRoom, entry: RoomEntry): void {
  if (room.entries.some((existing) => existing.id === entry.id)) return;
  room.entries.push(entry);
}

function makeDoor(input: {
  from: DreamRoom;
  toId: string;
  dir: StreetDir;
  toEntry: string;
  threshold?: RoomDoor["threshold"];
  levelDelta?: number;
  prompt?: string | null;
  id?: string;
  rect?: { x: number; y: number; w: number; h: number };
}): RoomDoor {
  const rect = input.rect ?? doorway(input.from, input.dir);
  return {
    id: input.id ?? `${input.from.id}--${input.dir}-${input.toId}`,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    toRoomId: input.toId,
    toEntryId: input.toEntry,
    type: "open",
    threshold: input.threshold ?? "door",
    levelDelta: input.levelDelta ?? 0,
    facing: APPROACH[input.dir],
    toFigureId: null,
    keyId: null,
    prompt: input.prompt ?? null,
  };
}

function addDoor(room: DreamRoom, door: RoomDoor): void {
  room.doors.push(door);
}

function punch(room: DreamRoom, door: RoomDoor): void {
  let cells = room.cells;
  for (let y = door.y; y < door.y + door.h; y++) {
    for (let x = door.x; x < door.x + door.w; x++) {
      cells = setCellMark(cells, x, y, "_");
    }
  }
  room.cells = cells;
}

function originOf(cell: Cell): { x: number; y: number } {
  return { x: cell.x * STRIDE_X, y: cell.y * STRIDE_Y };
}

function routeName(fromId: string, toId: string): string {
  if (WILD.test(fromId) || WILD.test(toId)) return "ТРОПА";
  return "УЛИЦА";
}

function emptyRoute(
  id: string,
  name: string,
  width: number,
  height: number,
  originX: number,
  originY: number,
  cells: string[],
): DreamRoom {
  return {
    id,
    name,
    kind: "place",
    tileSize: 16,
    width,
    height,
    originX,
    originY,
    cells,
    cellVariants: {},
    props: [],
    hotspots: [],
    entries: [
      { id: "from-w", x: 1.5, y: DOOR_Y + 1, facing: "e" },
      { id: "from-e", x: width - 1.5, y: DOOR_Y + 1, facing: "w" },
      { id: "from-n", x: DOOR_X + 1, y: 1.5, facing: "s" },
      { id: "from-s", x: DOOR_X + 1, y: height - 1.5, facing: "n" },
    ],
    doors: [],
    figureSlots: [],
    graphics: {
      floorRole: "path",
      wallRole: "tree",
      propRole: "prop",
      backdropImage: null,
      backdropFit: "cells",
      glitchPreset: "none",
    },
    camera: "follow",
    revisit: { escalates: false, note: null },
    meta: null,
    description: "Дорога между местами. Идёшь, пока не упрёшься в дверь.",
    atmosphere: "",
    personality: "ветер в траве, шаг слышно отдельно от города",
    tags: ["route"],
    copy: {},
    buildingId: null,
    level: 0,
  };
}

function sprinkle(x: number, y: number, salt: number): boolean {
  let hash = (x * 73856093) ^ (y * 19349663) ^ (salt * 83492791);
  hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
  return ((hash >>> 0) & 7) === 0;
}

function eastWestCells(width: number, height: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const onPath = y >= DOOR_Y && y < DOOR_Y + DOOR_SPAN;
      const atEnd = x === 0 || x === width - 1;
      if (onPath && atEnd) {
        row += "_";
        continue;
      }
      if (onPath) {
        row += "p";
        continue;
      }
      if (y === DOOR_Y - 1 || y === DOOR_Y + DOOR_SPAN) {
        row += x === 0 || x === width - 1 ? "t" : sprinkle(x, y, 3) ? "h" : "g";
        continue;
      }
      row += "t";
    }
    rows.push(row);
  }
  return rows;
}

function northSouthCells(width: number, height: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const onPath = x >= DOOR_X && x < DOOR_X + DOOR_SPAN;
      const atEnd = y === 0 || y === height - 1;
      if (onPath && atEnd) {
        row += "_";
        continue;
      }
      if (onPath) {
        row += "p";
        continue;
      }
      if (x === DOOR_X - 1 || x === DOOR_X + DOOR_SPAN) {
        row +=
          y === 0 || y === height - 1 ? "t" : sprinkle(x, y, 5) ? "h" : "g";
        continue;
      }
      row += "t";
    }
    rows.push(row);
  }
  return rows;
}

function groveCells(width: number, height: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = "";
    for (let x = 0; x < width; x++) {
      const edge = y === 0 || y === height - 1 || x === 0 || x === width - 1;
      if (edge) {
        row += "t";
        continue;
      }
      row += sprinkle(x, y, 11) ? "h" : sprinkle(x, y, 9) ? "g" : "t";
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Strip generated connectors, hang a two-tile doorway on every neighbour, and fill
 * the gap with a route you actually walk.
 */
export function applyStreetMap(rooms: readonly DreamRoom[]): DreamRoom[] {
  const next = rooms.filter((room) => !isGeneratedRoom(room.id)).map(cloneRoom);
  const byId = new Map(next.map((room) => [room.id, room]));
  const at = new Map<string, string>();
  for (const [id, cell] of Object.entries(STREET_CELLS)) {
    if (byId.has(id)) at.set(`${cell.x},${cell.y}`, id);
  }

  for (const room of next) {
    const kept = room.doors
      .filter((door) => isPuzzleDoor(door))
      .map((door) => ({
        ...door,
        threshold: "door" as const,
        toEntryId: door.toEntryId ?? "default",
      }));
    restoreRing(room);
    const cell = STREET_CELLS[room.id];
    if (cell) {
      const origin = originOf(cell);
      room.originX = origin.x;
      room.originY = origin.y;
      room.camera = "follow";
      if (room.kind === "meta") room.graphics.backdropFit = "cells";
    }
    room.doors = [];
    const defaultEntry =
      room.entries.find((entry) => entry.id === "default") ?? room.entries[0];
    room.entries = defaultEntry ? [{ ...defaultEntry, id: "default" }] : [];
    if (room.entries.length === 0) {
      room.entries.push({
        id: "default",
        x: room.width / 2,
        y: room.height - 2,
        facing: "n",
      });
    }
    for (const door of kept) addDoor(room, door);
  }

  const generated: DreamRoom[] = [];
  const dirs: StreetDir[] = ["e", "s"];
  for (const room of next) {
    const cell = STREET_CELLS[room.id];
    if (!cell) continue;
    for (const dir of dirs) {
      const step = STEP[dir];
      const neighbourId = at.get(`${cell.x + step.x},${cell.y + step.y}`);
      if (!neighbourId) continue;
      const neighbour = byId.get(neighbourId);
      if (!neighbour) continue;
      const pathId = `path-${cell.x}-${cell.y}-${dir}`;
      const name = routeName(room.id, neighbourId);
      const origin = originOf(cell);
      const path =
        dir === "e"
          ? emptyRoute(
              pathId,
              name,
              ROAD_W,
              PLACE_H,
              origin.x + PLACE_W,
              origin.y,
              eastWestCells(ROAD_W, PLACE_H),
            )
          : emptyRoute(
              pathId,
              name,
              PLACE_W,
              ROAD_H,
              origin.x,
              origin.y + PLACE_H,
              northSouthCells(PLACE_W, ROAD_H),
            );
      const fromDir = dir;
      const toDir = OPPOSITE[dir];
      addDoor(
        room,
        makeDoor({
          from: room,
          toId: pathId,
          dir: fromDir,
          toEntry: `from-${toDir}`,
          prompt: name === "ТРОПА" ? "на тропу" : "на улицу",
        }),
      );
      ensureEntry(room, entryFor(room, fromDir));
      addDoor(
        neighbour,
        makeDoor({
          from: neighbour,
          toId: pathId,
          dir: toDir,
          toEntry: `from-${fromDir}`,
          prompt: name === "ТРОПА" ? "на тропу" : "на улицу",
        }),
      );
      ensureEntry(neighbour, entryFor(neighbour, toDir));
      if (dir === "e") {
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: room.id,
            dir: "w",
            toEntry: "from-e",
            rect: { x: 0, y: DOOR_Y, w: 1, h: DOOR_SPAN },
          }),
        );
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: neighbour.id,
            dir: "e",
            toEntry: "from-w",
            rect: { x: ROAD_W - 1, y: DOOR_Y, w: 1, h: DOOR_SPAN },
          }),
        );
      } else {
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: room.id,
            dir: "n",
            toEntry: "from-s",
            rect: { x: DOOR_X, y: 0, w: DOOR_SPAN, h: 1 },
          }),
        );
        addDoor(
          path,
          makeDoor({
            from: path,
            toId: neighbour.id,
            dir: "s",
            toEntry: "from-n",
            rect: { x: DOOR_X, y: ROAD_H - 1, w: DOOR_SPAN, h: 1 },
          }),
        );
      }
      generated.push(path);
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of at.keys()) {
    const [x, y] = id.split(",").map(Number);
    minX = Math.min(minX, x!);
    minY = Math.min(minY, y!);
    maxX = Math.max(maxX, x!);
    maxY = Math.max(maxY, y!);
  }
  if (Number.isFinite(minX)) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const hasPlace = at.has(`${x},${y}`);
        const hasEast = at.has(`${x + 1},${y}`);
        const hasSouth = at.has(`${x},${y + 1}`);
        const origin = originOf({ x, y });
        if (!hasPlace) {
          generated.push(
            emptyRoute(
              `woods-${x}-${y}`,
              "РОЩА",
              STRIDE_X,
              STRIDE_Y,
              origin.x,
              origin.y,
              groveCells(STRIDE_X, STRIDE_Y),
            ),
          );
          continue;
        }
        if (!hasEast) {
          generated.push(
            emptyRoute(
              `gap-${x}-${y}-e`,
              "РОЩА",
              ROAD_W,
              PLACE_H,
              origin.x + PLACE_W,
              origin.y,
              groveCells(ROAD_W, PLACE_H),
            ),
          );
        }
        if (!hasSouth) {
          generated.push(
            emptyRoute(
              `gap-${x}-${y}-s`,
              "РОЩА",
              PLACE_W,
              ROAD_H,
              origin.x,
              origin.y + PLACE_H,
              groveCells(PLACE_W, ROAD_H),
            ),
          );
        }
        generated.push(
          emptyRoute(
            `gap-${x}-${y}-se`,
            "РОЩА",
            ROAD_W,
            ROAD_H,
            origin.x + PLACE_W,
            origin.y + PLACE_H,
            groveCells(ROAD_W, ROAD_H),
          ),
        );
      }
    }
  }

  const hotel = byId.get(HOTEL);
  const pool = byId.get(POOL);
  if (hotel && pool) {
    pool.originX = hotel.originX;
    pool.originY = hotel.originY;
    pool.camera = "follow";
    ensureEntry(hotel, {
      id: "from-lift",
      x: 5,
      y: 2.2,
      facing: "s",
    });
    ensureEntry(pool, {
      id: "from-lift",
      x: 5,
      y: 2.2,
      facing: "s",
    });
    addDoor(hotel, {
      id: `${HOTEL}--lift-${POOL}`,
      x: 3,
      y: 8,
      w: 2,
      h: 1,
      toRoomId: POOL,
      toEntryId: "from-lift",
      type: "open",
      threshold: "lift",
      levelDelta: 2,
      facing: "s",
      toFigureId: null,
      keyId: null,
      prompt: "лифт на третий этаж",
    });
    addDoor(pool, {
      id: `${POOL}--lift-${HOTEL}`,
      x: 3,
      y: 8,
      w: 2,
      h: 1,
      toRoomId: HOTEL,
      toEntryId: "from-lift",
      type: "open",
      threshold: "lift",
      levelDelta: 1,
      facing: "s",
      toFigureId: null,
      keyId: null,
      prompt: "лифт — только вверх",
    });
  }

  const all = [...next, ...generated];
  for (const room of all) {
    for (const door of room.doors) {
      if (door.threshold !== "door" && door.threshold !== "lift") continue;
      punch(room, door);
    }
  }
  return all;
}

export function neighbourOf(
  roomId: string,
  dir: StreetDir,
): string | undefined {
  const cell = STREET_CELLS[roomId];
  if (!cell) return undefined;
  const step = STEP[dir];
  for (const [id, other] of Object.entries(STREET_CELLS)) {
    if (other.x === cell.x + step.x && other.y === cell.y + step.y) return id;
  }
  return undefined;
}
