import { boxRoom } from "./box";

/** Empty, honest. Ten steps leave. Forty seconds of standing does nothing. */
export const M5 = boxRoom({
  id: "m5-odinochestvo",
  name: "ОДИНОЧЕСТВО",
  kind: "meta",
  description:
    "Файл на двадцать байт. Тег и больше ничего. Комната уже загружена. Выйти можно сразу.",
  atmosphere: "программная тишина",
  personality: "ничего не происходит, и это надо реализовать честно",
  tags: ["meta", "empty"],
  props: [],
  hotspots: [],
  glitchPreset: "none",
  backdropImage: "assets/rooms/m4-razvilka-gde-ty-ostalsia.png",
});
