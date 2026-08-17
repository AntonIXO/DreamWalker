import type { FigureAi } from "../../../src/shared/pack";
import { ADMITS, say } from "./kit";
import { mayYieldShard } from "../../../src/shared/yield";

export const glaz: FigureAi = {
  id: "glaz",
  placeholder: "сказать, зачем пришёл",
  hideMemoryOffer: true,
  skipExhaustionClamp: true,
  talk(ctx) {
    const truth = Number(ctx.getFlag("glaz.truth") ?? 0);
    const admits = ADMITS.test(ctx.said);
    if (admits) ctx.setFlag("glaz.truth", Math.max(truth, 2));

    const may = mayYieldShard({
      figureId: "glaz",
      utterance: ctx.utterance,
      visitCounts: ctx.visitCounts,
    });
    const yieldId = may && ctx.holdsShardId ? ctx.holdsShardId : null;

    if (admits && yieldId && truth >= 1) {
      return say("Это не работа. Это то же самое.", {
        action: "зрачок расширяется и больше не сужается",
        portraitState: "knows",
        yieldedShardId: yieldId,
        resonance: { declaration: "Ты пришёл забрать." },
        journalEntry: "Глаз узнал приём. Назвать — значит кончить обоих.",
      });
    }
    if (admits && yieldId) {
      return say("Ты пришёл забрать.", {
        action: "смотрит вниз. не моргает",
        portraitState: "knows",
        yieldedShardId: yieldId,
        journalEntry: "Последнее слово стоит формулировки. Дальше — выбор.",
      });
    }
    if (ctx.conversationTurns === 0) {
      return say("Тут уже был такой.", {
        action: "радужка медленно вращается",
        portraitState: "knows",
      });
    }
    return say(admits ? "Назови." : "Ты врёшь. Это тоже показание.", {
      action: "зрачок сужается на реплику",
      portraitState: "knows",
    });
  },
};
