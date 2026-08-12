/**
 * The procedure room the sanitar walks into before the dream.
 *
 * Layout follows the hand sketch: north bench (APOTHEOSIS), medical locker,
 * old terminal, ward doors; south bed, carpet, and the entrance the player
 * already came through. Cell letters:
 *
 *   . floor   , alt floor   # wall   = wall face   _ threshold
 */

import type { LobbyCell, LobbyDefinition } from "./types";

export const LOBBY_DEFINITION: LobbyDefinition = {
  id: "procedure",
  tileSize: 16,
  width: 18,
  height: 13,
  spawn: { x: 14.5, y: 10.4, facing: "w" },
  cells: [
    "##################",
    "==================",
    "#........,.......#",
    "#........,.......#",
    "#........,.......#",
    "#................#",
    "#......____......#",
    "#................#",
    "#........,.......#",
    "#........,.......#",
    "#________,_______#",
    "#................#",
    "##################",
  ],
  furniture: [
    { id: "desk", kind: "desk", x: 1, y: 2, w: 5, h: 3, solid: true },
    { id: "cross", kind: "cross", x: 7, y: 2, w: 2, h: 2, solid: true },
    { id: "locker", kind: "locker", x: 10, y: 2, w: 2, h: 2, solid: true },
    { id: "terminal", kind: "terminal", x: 13, y: 2, w: 2, h: 3, solid: true },
    {
      id: "ward-doors",
      kind: "ward-doors",
      x: 16,
      y: 2,
      w: 1,
      h: 3,
      solid: true,
    },
    { id: "bed", kind: "bed", x: 1, y: 7, w: 4, h: 3, solid: true },
    { id: "apparatus", kind: "apparatus", x: 5, y: 7, w: 2, h: 3, solid: true },
    { id: "drip", kind: "drip", x: 4, y: 6, w: 1, h: 2, solid: true },
    { id: "carpet", kind: "carpet", x: 8, y: 7, w: 5, h: 3, solid: false },
    { id: "plaque", kind: "plaque", x: 7, y: 1, w: 4, h: 1, solid: false },
    { id: "gonzo", kind: "gonzo", x: 11, y: 6, w: 1, h: 1, solid: false },
  ],
  hotspots: [
    {
      id: "terminal",
      kind: "terminal",
      x: 13.5,
      y: 5.15,
      reach: 1.6,
      prompt: "подключить",
    },
    {
      id: "patient",
      kind: "patient",
      x: 2.6,
      y: 10.15,
      reach: 1.6,
      prompt: "осмотреть",
    },
    {
      id: "apparatus",
      kind: "dream-entry",
      x: 6,
      y: 10.15,
      reach: 1.6,
      prompt: "подключиться",
    },
    {
      id: "locker",
      kind: "controls",
      x: 10.5,
      y: 4.15,
      reach: 1.55,
      prompt: "читать",
    },
    {
      id: "ward",
      kind: "settings",
      x: 15.2,
      y: 5.15,
      reach: 1.55,
      prompt: "осмотреть",
    },
  ],
  copy: {
    roomName: "Процедурная 3",
    slogan: "В дурке кто первый надел халат, тот и санитар!",
    hint: "WASD — ходить. E — подойти и взять.",
    plaque: "DREAM WALKER",
    "terminal.prompt": "подключить",
    "patient.prompt": "осмотреть",
    "controls.prompt": "читать",
    "settings.prompt": "осмотреть",
    "entry.prompt": "подключиться",
    "entry.ready": "начать смену",
    "entry.blocked": "разум не подключён",
    "patient.title": "Пациент",
    "patient.category": "СМЕНА",
    "patient.body":
      "Лежит под простынёй так, будто это обычная капельница, а не ограбление. В аппаратуре уже стоят шесть позиций BIP39. Остальные шесть надо вынести из сна и сложить в правильном порядке. Сама фраза здесь не пишется.",
    "settings.title": "Дверь в палату",
    "settings.category": "ЗАПИСЬ",
    "settings.body":
      "За этой дверью палата, в которую санитар больше не заходит ногами. Звук и тряска экрана берутся из системы: если в ОС включено «уменьшить движение», сдвиг полос при погружении гасится.",
    "settings.reduced":
      "Сейчас система просит меньше движения. Полосы останутся сменой прозрачности.",
    "settings.full": "Система движения не ограничивает.",
    "entry.title": "Аппарат",
    "entry.category": "АППАРАТ",
    "entry.blockedBody":
      "Разум не подключён. Без внешнего разума можно только учебный прогон: фигуры отвечают по сценарию, сон не населяется заново.",
    "entry.readyBody":
      "Кабель тёплый. Пациент уже внутри. Осталось лечь рядом с чужим сном и не назвать себя вслух.",
    "entry.train": "Учебный прогон",
    "entry.start": "Полезли",
    gonzo: "Пакет семечек «Золотой петушок». Кто-то жевал дежурство.",
  },
};

export function cellAt(
  definition: LobbyDefinition,
  tx: number,
  ty: number,
): LobbyCell {
  if (tx < 0 || ty < 0 || tx >= definition.width || ty >= definition.height) {
    return "void";
  }
  const mark = definition.cells[ty]?.[tx] ?? "#";
  if (mark === "#") return "wall";
  if (mark === "=") return "wallFace";
  if (mark === "_") return "threshold";
  if (mark === ",") return "floorAlt";
  if (mark === ".") return "floor";
  return "void";
}

export function furnitureBlocks(
  definition: LobbyDefinition,
  tx: number,
  ty: number,
): boolean {
  for (const piece of definition.furniture) {
    if (!piece.solid) continue;
    if (
      tx >= piece.x &&
      tx < piece.x + piece.w &&
      ty >= piece.y &&
      ty < piece.y + piece.h
    ) {
      return true;
    }
  }
  return false;
}
