import { boxRoom, look, prop, rift } from "./box";

/** Two approaches fail. The third works. A place, so it can hold a far hotspot. */
export const M6 = boxRoom({
  id: "m6-krugi-vokrug-pruda",
  name: "КРУГИ ВОКРУГ ПРУДА",
  kind: "place",
  description:
    "Полгода вокруг воды. Подходишь — забываешь всё. Говоришь «ну ладно». Ещё два круга.",
  atmosphere: "парк, вода, далёкая дорога",
  personality: "утки по кругу в ту же сторону, что и ты",
  tags: ["pond", "meta-adjacent"],
  props: [
    prop({ id: "prud", x: 8, y: 4, w: 4, h: 3, solid: false }),
    prop({ id: "lavochka", x: 3, y: 6 }),
  ],
  hotspots: [
    look({
      id: "figura-na-beregu",
      x: 16,
      y: 4,
      prompt: "кто-то на другом берегу",
      reach: 1.8,
    }),
  ],
  doors: [
    {
      // On the wall face, not on the floor: the path back is a створ you press into,
      // and while it is sealed pressing into it is the room refusing to let go.
      ...rift({
        id: "m6-krugi-vokrug-pruda--exit",
        x: 17,
        toRoomId: "19-dvor-i-oranzhevye-lavochki",
        prompt: "дорожка назад",
      }),
      type: "sealed",
    },
  ],
  figureSlots: [{ id: "a", x: 16, y: 4 }],
  backdropImage: "assets/rooms/19-dvor-i-oranzhevye-lavochki.png",
  glitchPreset: "split",
});
