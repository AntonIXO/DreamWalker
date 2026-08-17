import type { RoomDoor } from "../../../src/shared/room";
import { boxRoom, look } from "./box";

function numberedDoor(index: number): RoomDoor {
  return {
    id: `m8-5854--day-${index}`,
    x: 2 + index * 2,
    y: 1,
    w: 1,
    h: 1,
    toRoomId: "m8-den",
    toEntryId: "default",
    type: "open",
    threshold: "rift",
    levelDelta: 0,
    facing: null,
    toFigureId: null,
    keyId: null,
    prompt: String(5846 + index),
  };
}

/** Corridor of days. Brute force is the wrong door. */
export const M8 = boxRoom({
  id: "m8-5854",
  name: "5854-Й ДЕНЬ",
  kind: "place",
  description:
    "Коридор. Над дверями номера. За каждой — одна и та же комната. Кроме одной.",
  atmosphere: "щелчок табло, редкий, вразнобой",
  personality: "дальние номера перещёлкиваются, ближние нет",
  tags: ["days", "corridor"],
  doors: Array.from({ length: 8 }, (_, index) => numberedDoor(index)),
  hotspots: [
    look({
      id: "nomera",
      x: 10,
      y: 5,
      prompt: "номера над дверями",
      reach: 2,
    }),
  ],
  camera: "follow",
  backdropImage: "assets/rooms/17-dush-iz-kotorogo-nelzia-vyiti.png",
  glitchPreset: "split",
});

export const M8_DEN = boxRoom({
  id: "m8-den",
  name: "КОМНАТА ДНЯ",
  kind: "place",
  description: "Кровать, окно, стол. Разницы между 4102 и 5308 нет.",
  atmosphere: "одна и та же комната",
  personality: "отрисована один раз",
  tags: ["days"],
  doors: [
    {
      id: "m8-den--back",
      x: 1,
      y: 9,
      w: 2,
      h: 1,
      toRoomId: "m8-5854",
      toEntryId: "default",
      type: "open",
      threshold: "door",
      levelDelta: 0,
      facing: null,
      toFigureId: null,
      keyId: null,
      prompt: "в коридор",
    },
  ],
  backdropImage: "assets/rooms/08-kvartira-v-kotoroi-zhivut-drugie.png",
  glitchPreset: "none",
});
