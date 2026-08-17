import type { FigureAi } from "../../../src/shared/pack";
import { ADMITS, BUSINESS, count, say } from "./kit";
import { KURT_THRESHOLD } from "../../../src/player/game/exhaustion";

export const lysyi: FigureAi = {
  id: "lysyi",
  placeholder: "сойтись в истории",
  hideMemoryOffer: true,
  talk(ctx) {
    if (ctx.exhaustion >= KURT_THRESHOLD) {
      return say("Ладно. Поезжай.", {
        action: "смотрит на часы и теряет интерес",
        journalEntry:
          "Измотанный человек не похож на того, у кого что-то есть.",
        portraitState: "neutral",
      });
    }
    if (ADMITS.test(ctx.said)) {
      return say("Погоди, я не понял. Ещё раз, с начала.", {
        action: "не повышает голос. ни разу",
        tell: { quoted: ctx.utterance.slice(0, 48) },
        portraitState: "wary",
      });
    }
    const n = count(ctx, "lysyi.ask");
    if (n === 1) {
      return say("Так. А зовут как.", {
        action: "ждёт. не перебивает",
        portraitState: "interested",
      });
    }
    if (n === 2 && BUSINESS.test(ctx.said)) {
      return say("Быстро бегаешь?", {
        action: "смотрит на часы",
        portraitState: "wary",
      });
    }
    if (ctx.conversationTurns >= 3 && !ADMITS.test(ctx.said)) {
      return say("Ну ты присядь, что стоять.", {
        action: "уже всё решил и отпускает",
        journalEntry: "Он действительно отпустит. Ему скучно.",
        portraitState: "interested",
      });
    }
    return say("Ты чего дрожишь-то.", {
      action: "стоит так, будто вопрос уже решён",
      portraitState: "interested",
    });
  },
};
