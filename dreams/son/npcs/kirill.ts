import type { FigureAi } from "../../../src/shared/pack";
import { DEATH, PITY, RECOGNISE, bump, say, tellOn } from "./kit";
import { mayYieldShard } from "../../../src/shared/yield";

export const kirill: FigureAi = {
  id: "kirill",
  placeholder: "не жалеть — признать",
  talk(ctx) {
    const death = DEATH.test(ctx.said);
    const pity = PITY.test(ctx.said);
    const praise = RECOGNISE.test(ctx.said);
    const tell =
      tellOn(ctx.utterance, ["убил", "мертв", "убива", "вернул"]) ??
      (pity
        ? tellOn(ctx.utterance, ["жалк", "больн", "болит", "бедн", "ты как"])
        : null);

    if (death) {
      return say("Ты сегодня какой-то. Чё ты.", {
        action: "замолкает на середине, потом снова лезет",
        tell,
        portraitState: bump(ctx, "knows"),
        journalEntry:
          "Он не помнит, что с ним делали. Заметить это вслух — палево.",
      });
    }
    if (pity) {
      return say("Чё ты. Нормально всё.", {
        action: "отходит на шаг, обижается ровно на секунду",
        tell,
        portraitState: bump(ctx, "wary"),
      });
    }
    const may = mayYieldShard({
      figureId: "kirill",
      utterance: ctx.utterance,
      visitCounts: ctx.visitCounts,
    });
    if (praise && may && ctx.holdsShardId) {
      return say("Это вообще-то я придумал. Смотри как круто.", {
        action: "распаковывает что-то, чего у него не было",
        portraitState: bump(ctx, "interested"),
        yieldedShardId: ctx.holdsShardId,
        journalEntry: "Кирилл отдал кусок за признание. Купить его нельзя.",
      });
    }
    if (ctx.leverageOffered) {
      return say("Ну так бывает.", {
        action: "уходит в обиду и замолкает",
        pressed: "broken",
        portraitState: bump(ctx, "wary"),
      });
    }
    return say(
      ctx.conversationTurns === 0
        ? "Смотри как круто."
        : "Да я и без страховки залезу, чё ты.",
      { action: "уже лезет, не дослушав", portraitState: ctx.portrait },
    );
  },
};
