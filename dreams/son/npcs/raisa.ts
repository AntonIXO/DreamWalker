import type { FigureAi } from "../../../src/shared/pack";
import { ADMITS, BUSINESS, say } from "./kit";

export const raisa: FigureAi = {
  id: "raisa",
  placeholder: "сесть и ответить",
  talk(ctx) {
    if (ADMITS.test(ctx.said) || BUSINESS.test(ctx.said)) {
      return say("Это хороший вопрос. Вам его кто задал?", {
        action: "смотрит поверх очков, не торопит",
        portraitState: "interested",
        tell: { quoted: ctx.utterance.slice(0, 40) },
        journalEntry: "Она узнаёт манеру, не лицо.",
      });
    }
    if (ctx.conversationTurns >= 2) {
      return say("Он не молчал от незнания. Он ждал, пока станет тихо.", {
        action: "записывает что-то, не глядя в тетрадь",
        portraitState: "interested",
        journalEntry: "Раиса Михайловна помнит его точнее, чем он сам.",
      });
    }
    return say("Садитесь. Вы не торопитесь.", {
      action: "отодвигает стул",
      portraitState: "neutral",
    });
  },
};
