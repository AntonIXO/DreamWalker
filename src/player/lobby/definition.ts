/**
 * The procedure room the sanitar walks into before the dream.
 *
 * Layout follows the authored mural: north workbench / controls / terminal / ward,
 * south bed / patient apparatus / carpet, and dense absurd set dressing around the
 * perimeter. Collision rectangles follow what is actually painted, including the
 * non-interactive furniture; an attractive mural may not create invisible walls or
 * let the sanitar walk through a capybara cabinet. Cell letters:
 *
 *   . floor   , alt floor   # wall   = wall face   _ threshold
 */

import { cellAt as sharedCellAt, rectBlocks } from "../../shared/roomGrid";
import type { LobbyCell, LobbyDefinition } from "./types";

export const LOBBY_DEFINITION: LobbyDefinition = {
  id: "procedure",
  tileSize: 16,
  width: 18,
  height: 13,
  spawn: { x: 13, y: 10.5, facing: "w" },
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
    { id: "roots-cabinet", kind: "decor", x: 0, y: 1, w: 3, h: 3, solid: true },
    { id: "desk", kind: "desk", x: 2, y: 1, w: 5, h: 2, solid: true },
    { id: "cross", kind: "cross", x: 6, y: 1, w: 2, h: 2, solid: true },
    { id: "locker", kind: "locker", x: 8, y: 1, w: 2, h: 2, solid: true },
    { id: "terminal", kind: "terminal", x: 10, y: 1, w: 2, h: 2, solid: true },
    { id: "crt-stove", kind: "decor", x: 12, y: 1, w: 2, h: 2, solid: true },
    {
      id: "ward-doors",
      kind: "ward-doors",
      x: 13,
      y: 1,
      w: 4,
      h: 2,
      solid: true,
    },
    { id: "coat-tags", kind: "decor", x: 16, y: 1, w: 2, h: 2, solid: true },
    { id: "printer-bank", kind: "decor", x: 16, y: 3, w: 2, h: 4, solid: true },
    { id: "side-cabinet", kind: "decor", x: 16, y: 6, w: 2, h: 3, solid: true },
    {
      id: "meat-dome-sofa",
      kind: "decor",
      x: 14,
      y: 8,
      w: 4,
      h: 4,
      solid: true,
    },
    { id: "bed", kind: "bed", x: 1, y: 7, w: 3, h: 4, solid: true },
    {
      id: "apparatus",
      kind: "apparatus",
      x: 3.15,
      y: 6.8,
      w: 2.95,
      h: 3.6,
      solid: true,
    },
    { id: "drip", kind: "drip", x: 4, y: 6, w: 1, h: 1, solid: true },
    { id: "carpet", kind: "carpet", x: 7, y: 7, w: 6, h: 4, solid: false },
    { id: "plaque", kind: "plaque", x: 7, y: 1, w: 4, h: 1, solid: false },
    {
      id: "gonzo",
      kind: "gonzo",
      x: 8.5,
      y: 6.7,
      w: 0.8,
      h: 0.6,
      solid: false,
    },
  ],
  hotspots: [
    {
      id: "terminal",
      kind: "terminal",
      x: 11,
      y: 3.5,
      reach: 1.6,
      prompt: "подключить",
    },
    {
      id: "patient",
      kind: "patient",
      x: 2,
      y: 10.8,
      reach: 1.6,
      prompt: "осмотреть",
    },
    {
      id: "apparatus",
      kind: "dream-entry",
      x: 4.6,
      y: 10.85,
      reach: 1.6,
      prompt: "подключиться",
    },
    {
      id: "locker",
      kind: "controls",
      x: 9,
      y: 3.5,
      reach: 1.55,
      prompt: "читать",
    },
    {
      id: "ward",
      kind: "settings",
      x: 15,
      y: 3.5,
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
      "Разум не подключён. Учебный прогон всё равно собирает всех людей и все комнаты, только раскладку пишет сценарий, не модель.",
    "entry.readyBody":
      "Кабель тёплый. Пациент уже внутри. «Полезли» — сон сам рассадит всех заново. Учебный прогон — та же карта сразу, без ожидания модели.",
    "entry.train": "Учебный прогон",
    "entry.start": "Полезли",
    gonzo: "Пакет семечек «Золотой петушок». Кто-то жевал дежурство.",
  },
};

/** Both of these are the shared room readers, narrowed to the lobby's own types. */

export function cellAt(
  definition: LobbyDefinition,
  tx: number,
  ty: number,
): LobbyCell {
  return sharedCellAt(definition, tx, ty);
}

export function furnitureBlocks(
  definition: LobbyDefinition,
  tx: number,
  ty: number,
): boolean {
  return rectBlocks(definition.furniture, tx, ty);
}
