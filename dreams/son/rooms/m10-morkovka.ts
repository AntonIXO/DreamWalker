import { boxRoom, look, prop, rift } from "./box";

export const M10 = boxRoom({
  id: "m10-zamorozhennaia-morkovka",
  name: "ЗАМОРОЖЕННАЯ МОРКОВКА",
  kind: "place",
  description:
    "Кухня. Палец в пакете моркови. Пол вытерт. На экране незакрытая скобка.",
  atmosphere: "кулер, компрессор. Ни одного звука боли.",
  personality: "на экране набирается строка, которую никто не печатает",
  tags: ["kitchen", "money-adjacent"],
  props: [
    prop({ id: "morozilka", x: 3, y: 3 }),
    prop({ id: "noutbuk", x: 8, y: 4 }),
    prop({ id: "paket", x: 12, y: 5, w: 1, h: 1 }),
  ],
  hotspots: [
    look({
      id: "paket",
      x: 12.5,
      y: 6.5,
      prompt: "пакет моркови",
      propId: "paket",
      refusal: "Ледяной. Рука не вынимается.",
    }),
    look({
      id: "noutbuk",
      x: 9,
      y: 6.15,
      prompt: "ноутбук с открытым конфигом",
      propId: "noutbuk",
    }),
    look({
      id: "vypiska",
      x: 5,
      y: 7,
      prompt: "выписка, сложенная вчетверо",
    }),
  ],
  doors: [
    rift({
      id: "m10-zamorozhennaia-morkovka--to-rm",
      x: 1,
      toRoomId: "m7-rm-rf",
      prompt: "шлифмашинка",
    }),
    rift({
      id: "m10-zamorozhennaia-morkovka--to-clinic",
      x: 5,
      toRoomId: "14-poliklinika-v-kaluge",
      prompt: "выписка",
    }),
  ],
  backdropImage: "assets/rooms/14-poliklinika-v-kaluge.png",
  glitchPreset: "none",
});
