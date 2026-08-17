import type { FigureAi } from "../../../src/shared/pack";
import { BUSINESS, IDLE, count, say } from "./kit";

export const kurt: FigureAi = {
  id: "kurt",
  placeholder: "не по делу",
  hideMemoryOffer: true,
  hideLeverage: true,
  skipExhaustionClamp: true,
  talk(ctx) {
    if (ctx.getFlag("kurt.dismissed") === true) {
      return say("Я это уже слышал. Не от тебя.", {
        action: "встаёт, не глядя",
      });
    }
    const business = BUSINESS.test(ctx.said) && !IDLE.test(ctx.said);
    if (business) {
      const n = count(ctx, "kurt.indifference");
      if (n >= 3) {
        ctx.setFlag("kurt.dismissed", true);
        return say("Ладно. Ты занят.", {
          action: "уходит из кадра, не из комнаты — его просто нет",
          journalEntry: "Курт больше не придёт в этом прохождении.",
        });
      }
      return say("Ты сейчас про себя или про него?", {
        action: "смотрит в пол",
        portraitState: "neutral",
      });
    }
    const idle = count(ctx, "kurt.idle");
    if (idle >= 3) {
      return say("Тебе не обязательно доделывать.", {
        action: "один раз смотрит на тебя",
        journalEntry: "Он отдал слово между прочим. Не как цену — как паузу.",
        portraitState: "neutral",
      });
    }
    return say(
      idle === 1
        ? "Не, ну ты сядь."
        : "Она нормальная песня была. Просто короткая.",
      { action: "сидит у стены, не в центре", portraitState: "neutral" },
    );
  },
};
