import { boxRoom, look, prop, rift } from "./box";

export const M9 = boxRoom({
  id: "m9-shkaf",
  name: "ШКАФ",
  kind: "place",
  description:
    "Детская. Тёплая, неискажённая. Надпись внутри шкафа написана не для тебя.",
  atmosphere: "телевизор за стеной, разговор двух взрослых",
  personality: "дверца шкафа очень медленно открывается шире",
  tags: ["childhood"],
  props: [
    prop({ id: "shkaf", x: 8, y: 3 }),
    prop({ id: "korobka", x: 12, y: 5, w: 1, h: 1 }),
  ],
  hotspots: [
    look({
      id: "nadpis",
      x: 9,
      y: 5.15,
      prompt: "надпись внутри шкафа",
      propId: "shkaf",
    }),
    look({
      id: "korobka",
      x: 12.5,
      y: 6.5,
      prompt: "пустая коробка от игрушки",
      propId: "korobka",
    }),
  ],
  doors: [
    rift({
      id: "m9-shkaf--to-pond",
      x: 1,
      toRoomId: "m6-krugi-vokrug-pruda",
      prompt: "фломастер",
    }),
    rift({
      id: "m9-shkaf--to-shop",
      x: 5,
      toRoomId: "05-shesterochka",
      prompt: "коробка",
    }),
  ],
  figureSlots: [{ id: "a", x: 6, y: 7 }],
  backdropImage: "assets/rooms/08-kvartira-v-kotoroi-zhivut-drugie.png",
  glitchPreset: "none",
  copy: {
    nadpis: "Никогда не верьте маме, она не сдерживает свои обещания!",
  },
});
