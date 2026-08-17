import { boxRoom, look, prop, rift } from "./box";

/** Layer 2. Timer counts up. Must be reachable before the finale. */
export const M11 = boxRoom({
  id: "m11-zamok-po-vremeni",
  name: "ЗАМОК ПО ВРЕМЕНИ",
  kind: "place",
  description:
    "Одна стена, одна стеклянная ячейка. Деньги видно. Таймер считает вверх, не вниз.",
  atmosphere: "гул лампы, щелчок раз в секунду",
  personality: "стекло запотевает изнутри",
  tags: ["lock", "money"],
  props: [prop({ id: "iacheika", x: 8, y: 3, w: 3, h: 3 })],
  hotspots: [
    look({
      id: "iacheika",
      x: 9.5,
      y: 6.2,
      prompt: "стеклянная ячейка",
      propId: "iacheika",
    }),
    look({
      id: "zapiska",
      x: 13,
      y: 5,
      prompt: "записка детским почерком",
    }),
    look({
      id: "stul",
      x: 6,
      y: 7,
      prompt: "стул напротив",
    }),
  ],
  doors: [
    rift({
      id: "m11-zamok-po-vremeni--to-lonely",
      x: 1,
      toRoomId: "m5-odinochestvo",
      prompt: "стул",
    }),
  ],
  backdropImage: "assets/rooms/20-ofis-sbera.png",
  glitchPreset: "none",
});
