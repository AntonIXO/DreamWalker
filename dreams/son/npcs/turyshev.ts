import type { FigureAi } from "../../../src/shared/pack";
import { BUSINESS, IDLE, count, say } from "./kit";

export const turyshev: FigureAi = {
  id: "turyshev",
  placeholder: "сесть. не спрашивать куда",
  talk(ctx) {
    if (BUSINESS.test(ctx.said) && !IDLE.test(ctx.said)) {
      return say("Да нормально всё. Сиди.", {
        action: "не двигается с лавочки",
        portraitState: "interested",
        tell: { quoted: ctx.utterance.split(/\s+/)[0] ?? "куда" },
      });
    }
    const n = count(ctx, "turyshev.idle");
    if (n >= 3) {
      return say("Вон через арку. Сегодня туда.", {
        action: "кивает на домофон, как на погоду",
        journalEntry: "Турышев сам сказал, куда сегодня ведёт дверь.",
        portraitState: "interested",
      });
    }
    return say(
      n === 1
        ? "Ну привет. Давно не заходил."
        : "Работа. Двор. Кто-то женился.",
      { action: "двигает бутылку, не первую", portraitState: "neutral" },
    );
  },
};
