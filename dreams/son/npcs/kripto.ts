import type { FigureAi } from "../../../src/shared/pack";
import { ADMITS, MONEY, say } from "./kit";

export const kripto: FigureAi = {
  id: "kripto-bro",
  placeholder: "слушать соседний ответ",
  talk(ctx) {
    if (ADMITS.test(ctx.said) || MONEY.test(ctx.said)) {
      return say("Смотри, тут какая история. Надо было ждать другой поезд.", {
        action: "кивает, как будто это твоя вина",
        portraitState: "interested",
        journalEntry:
          "Он один скажет прямо про деньги. Врать ему незачем: он уже выиграл.",
      });
    }
    if (ctx.said.includes("кинул") || ctx.said.includes("вор")) {
      return say("Да, да. Полностью согласен. Так вот, смотри.", {
        action: "соглашается и продолжает",
        portraitState: "neutral",
      });
    }
    return say("Ты на какой конференции был, кстати?", {
      action: "ходит по платформе, никто его не узнаёт",
      portraitState: "neutral",
    });
  },
};
