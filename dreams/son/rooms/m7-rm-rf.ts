import { boxRoom, look, prop } from "./box";

const NOTES = [
  { id: "zametki", x: 3, y: 3, prompt: "заметки на стене" },
  { id: "shemy", x: 6, y: 3, prompt: "схемы" },
  { id: "monitor", x: 9, y: 3, prompt: "монитор" },
  { id: "stol", x: 12, y: 4, prompt: "стол, за которым работали" },
];

/** The room deletes itself left to right. Grab one thing. */
export const M7 = boxRoom({
  id: "m7-rm-rf",
  name: "rm -rf",
  kind: "meta",
  description:
    "Три месяца работы. Одна команда. Была симлинка. Комната удаляет себя спокойно.",
  atmosphere: "вентилятор ноутбука, потом меньше, потом ничего",
  personality: "пропадает по одному объекту, слева направо",
  tags: ["meta", "erasure"],
  props: NOTES.map((item) => prop({ id: item.id, x: item.x, y: item.y })),
  hotspots: NOTES.map((item) =>
    look({
      id: item.id,
      x: item.x + 1,
      y: item.y + 2.15,
      prompt: item.prompt,
      propId: item.id,
    }),
  ),
  backdropImage: "assets/rooms/09-hakaton-tretii-po-schetu.png",
  glitchPreset: "double-edge",
});
