import type { FigureAi } from "../../../src/shared/pack";
import { ADMITS, MONEY, bump, hasAny, say, tellOn } from "./kit";

const DREAM_STEMS = [
  "кирилл",
  "канав",
  "груш",
  "лавочк",
  "глаз",
  "щенок",
  "снотвор",
];

export const anton: FigureAi = {
  id: "anton",
  placeholder: "не быть слишком точным",
  talk(ctx) {
    if (MONEY.test(ctx.said) || ADMITS.test(ctx.said)) {
      return say("Ну и дальше как-то так. А что дальше не помню.", {
        action: "не поднимает головы от телефона",
        portraitState: bump(ctx, "wary"),
        tell: tellOn(ctx.utterance, ["кошел", "битк", "деньг", "сид"]),
        journalEntry: "Свои деньги в чужом сне интересуют только вора.",
      });
    }
    const precise = hasAny(ctx.said, DREAM_STEMS);
    if (precise) {
      const tell = tellOn(ctx.utterance, DREAM_STEMS);
      const face = bump(ctx, ctx.conversationTurns >= 2 ? "knows" : "wary");
      return say(
        face === "knows"
          ? "На улице сегодня нормально. Я вот думал про прошивку."
          : "Откуда ты это… ну ладно. Я тогда не успел, и дальше как-то так.",
        {
          action:
            face === "knows"
              ? "поднимает голову. один раз"
              : "листнет что-то в телефоне",
          tell,
          portraitState: face,
        },
      );
    }
    return say(
      "У меня на том телефоне камера открывалась семь секунд. Ну и дальше.",
      {
        action: "говорит в экран",
        portraitState: ctx.portrait,
      },
    );
  },
};
