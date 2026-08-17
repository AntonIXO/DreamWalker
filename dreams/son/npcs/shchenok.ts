import type { FigureAi } from "../../../src/shared/pack";
import { ADMITS, say } from "./kit";

const LINES = [
  "А мы ещё будем?",
  "Я почти. В тот раз почти.",
  "Ноги не идут. Ничего.",
  "Тут спать хорошо.",
  "Ты долго.",
  "Ещё раз. Можно?",
];

export const shchenok: FigureAi = {
  id: "shchenok",
  placeholder: "просто поговорить",
  hideMemoryOffer: true,
  hideLeverage: true,
  skipExhaustionClamp: true,
  talk(ctx) {
    if (ctx.offeredMemoryText || ctx.leverageOffered) {
      ctx.setFlag("shchenok.pressed", true);
      return say("Не понял. Ещё будем?", {
        action: "хвост стучит, не отрываясь",
        portraitState: "neutral",
        journalEntry: "С ним нельзя работать. Только говорить или уйти.",
      });
    }
    if (ADMITS.test(ctx.said)) {
      return say("А мы ещё будем?", {
        action: "хвост стучит по полу",
        portraitState: "neutral",
        journalEntry: "Он ждал. Он не знает, что игра кончилась.",
        figureMemorySummary:
          "Санитар сказал, зачем пришёл. Щенок не понял слов.",
      });
    }
    return say(LINES[ctx.conversationTurns % LINES.length]!, {
      action: "лежит на боку, передними переступает ближе",
      portraitState: "neutral",
    });
  },
};
