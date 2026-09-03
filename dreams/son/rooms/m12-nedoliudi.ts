import { boxRoom, look, prop, rift } from "./box";

export const M12 = boxRoom({
  id: "m12-nedoliudi",
  name: "НЕДОЛЮДИ",
  kind: "meta",
  description:
    "Созвон. Двенадцать квадратов. Твой — чёрный. Микрофона нет. Квадраты гаснут.",
  atmosphere: "двенадцать голосов внахлёст, потом меньше, потом слышно",
  personality: "твой чёрный квадрат чуть светлее остальных чёрных",
  tags: ["meta", "call"],
  props: [
    prop({ id: "ekran", x: 7, y: 2, w: 6, h: 3, solid: true }),
    prop({ id: "stul-1", x: 4, y: 6, w: 1, h: 1 }),
    prop({ id: "stul-2", x: 7, y: 6, w: 1, h: 1 }),
    prop({ id: "stul-3", x: 10, y: 6, w: 1, h: 1 }),
  ],
  hotspots: [
    look({
      id: "ekran",
      x: 10,
      y: 5.2,
      prompt: "сетка видеозвонка",
      propId: "ekran",
    }),
    look({
      id: "schet",
      x: 14,
      y: 7,
      prompt: "счёт, на котором валюта смазана",
    }),
  ],
  doors: [
    // `rooms-meta.md` М12: the deck nobody opened goes back to the hackathon, and the
    // invoice with the smudged currency goes to the shop where money is argued over.
    rift({
      id: "m12-nedoliudi--to-hackathon",
      x: 1,
      toRoomId: "09-hakaton-tretii-po-schetu",
      prompt: "питч-дек",
    }),
    rift({
      id: "m12-nedoliudi--to-shop",
      x: 5,
      toRoomId: "05-shesterochka",
      prompt: "счёт",
    }),
  ],
  backdropImage: "assets/rooms/23-nigeriia-konferenciia.png",
  glitchPreset: "wrong-palette",
});
