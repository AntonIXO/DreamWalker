import type {
  DreamRoom,
  RoomDoor,
  RoomHotspot,
  RoomProp,
} from "../../../src/shared/room";

const BOX_CELLS = [
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
];

export function rift(input: {
  id: string;
  x: number;
  toRoomId: string;
  prompt: string;
  y?: number;
}): RoomDoor {
  return {
    id: input.id,
    x: input.x,
    y: input.y ?? 1,
    w: 2,
    h: 1,
    toRoomId: input.toRoomId,
    toEntryId: "default",
    type: "open",
    threshold: "rift",
    levelDelta: 0,
    facing: null,
    toFigureId: null,
    keyId: null,
    prompt: input.prompt,
  };
}

export function look(input: {
  id: string;
  x: number;
  y: number;
  prompt: string;
  propId?: string;
  reach?: number;
  once?: boolean;
  refusal?: string | null;
  clueId?: string | null;
}): RoomHotspot {
  return {
    id: input.id,
    kind: "look",
    x: input.x,
    y: input.y,
    reach: input.reach ?? 1.4,
    prompt: input.prompt,
    refusal: input.refusal ?? null,
    clueId: input.clueId ?? null,
    action: null,
    once: input.once ?? false,
    dwellMs: null,
    propId: input.propId ?? null,
  };
}

export function prop(input: {
  id: string;
  x: number;
  y: number;
  w?: number;
  h?: number;
  solid?: boolean;
}): RoomProp {
  return {
    id: input.id,
    x: input.x,
    y: input.y,
    w: input.w ?? 2,
    h: input.h ?? 2,
    solid: input.solid ?? true,
    role: "prop",
    image: null,
  };
}

export function boxRoom(input: {
  id: string;
  name: string;
  kind: "place" | "meta";
  description: string;
  atmosphere: string;
  personality: string;
  tags?: string[];
  copy?: Record<string, string>;
  props?: RoomProp[];
  hotspots?: RoomHotspot[];
  doors?: RoomDoor[];
  figureSlots?: Array<{ id: string; x: number; y: number }>;
  width?: number;
  height?: number;
  cells?: string[];
  camera?: "frame" | "follow";
  backdropImage?: string | null;
  glitchPreset?: DreamRoom["graphics"]["glitchPreset"];
  metaMs?: { minMs: number; maxMs: number } | null;
}): DreamRoom {
  const width = input.width ?? 20;
  const height = input.height ?? 11;
  const cells = input.cells ?? BOX_CELLS;
  const isMeta = input.kind === "meta";
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    tileSize: 16,
    width,
    height,
    cells,
    cellVariants: {},
    props: input.props ?? [],
    hotspots: input.hotspots ?? [],
    entries: [{ id: "default", x: width / 2, y: height - 2, facing: "n" }],
    doors: input.doors ?? [],
    figureSlots: input.figureSlots ?? [],
    graphics: {
      floorRole: "floor",
      wallRole: "wall",
      propRole: "prop",
      backdropImage: input.backdropImage ?? "assets/rooms/m1-korni.png",
      backdropFit: isMeta ? "screen" : "cells",
      glitchPreset: input.glitchPreset ?? "wrong-palette",
    },
    camera: input.camera ?? "frame",
    revisit: { escalates: false, note: null },
    meta: isMeta
      ? (input.metaMs ?? { minMs: 86_400_000, maxMs: 86_400_000 })
      : null,
    description: input.description,
    atmosphere: input.atmosphere,
    personality: input.personality,
    tags: input.tags ?? (isMeta ? ["meta"] : []),
    copy: input.copy ?? {},
    buildingId: null,
    level: 0,
    originX: 0,
    originY: 0,
  };
}

export function cloneRoom(room: DreamRoom): DreamRoom {
  return structuredClone(room);
}

export function addSlot(
  room: DreamRoom,
  slot: { id: string; x: number; y: number },
): void {
  if (room.figureSlots.some((entry) => entry.id === slot.id)) return;
  room.figureSlots.push(slot);
}

export function addDoor(room: DreamRoom, door: RoomDoor): void {
  if (room.doors.some((entry) => entry.id === door.id)) return;
  room.doors.push(door);
}
