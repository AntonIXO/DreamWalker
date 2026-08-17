import type { FigureAi } from "../../../src/shared/pack";
import { MONEY, say, tellOn } from "./kit";

export const mama: FigureAi = {
  id: "mama",
  placeholder: "не спрашивать про траты сразу",
  talk(ctx) {
    if (MONEY.test(ctx.said)) {
      return say("Я же говорила. И зубы до сих пор не сделаны.", {
        action: "накидывает проволоку ровнее, чем нужно",
        tell: tellOn(ctx.utterance, ["деньг", "трат", "рубл"]),
        portraitState: "wary",
        journalEntry: "Мама знает про все траты. Скажет с укором.",
      });
    }
    return say("Ничего, поспи ещё. Они не нападут, если не давать.", {
      action: "звери танцуют, она не смотрит",
      portraitState: "neutral",
    });
  },
};
