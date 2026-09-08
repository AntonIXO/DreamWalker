import { describe, expect, test } from "bun:test";

import {
  dialogueTurnMessages,
  dialogueWorldRules,
  limitDialogueReply,
} from "./dialogue-messages";

describe("limitDialogueReply", () => {
  test("caps the live four-sentence answer at the two witnessed facts", () => {
    expect(
      limitDialogueReply(
        "Бутылки не хватает. Ты её взял — я видел. Вчера ещё урна пропала. Садись пока.",
      ),
    ).toBe("Бутылки не хватает. Ты её взял — я видел.");
  });

  test("quoted punctuation does not cut the quotation or its attribution", () => {
    expect(
      limitDialogueReply(
        "Ты сказал «Куда?», а сам ушёл. Бутылка здесь. Третье.",
      ),
    ).toBe("Ты сказал «Куда?», а сам ушёл. Бутылка здесь.");
    expect(
      limitDialogueReply(
        'He said "Stop!" and sat down. The cup is here. Another thing.',
        "en",
      ),
    ).toBe('He said "Stop!" and sat down. The cup is here.');
  });

  test("wrapping the answer in quotes cannot bypass the sentence limit", () => {
    expect(limitDialogueReply("«Первое. Второе. Третье. Четвёртое.»")).toBe(
      "«Первое. Второе.»",
    );
    expect(limitDialogueReply("«Первое. Второе. Начало третьего")).toBe(
      "«Первое. Второе.»",
    );
  });
});

describe("dialogueTurnMessages", () => {
  test("turns the cycle transcript into an AI SDK chat, current line last", () => {
    const messages = dialogueTurnMessages(
      [
        { speaker: "sanitar", text: "Привет. Как дела?" },
        {
          speaker: "figure",
          text: "Садись. Лавки новые, оранжевые.",
        },
      ],
      "Цикл: 1",
      "Куда сегодня идти?",
    );
    expect(messages).toEqual([
      { role: "user", content: "Привет. Как дела?" },
      { role: "assistant", content: "Садись. Лавки новые, оранжевые." },
      {
        role: "user",
        content:
          "Цикл: 1\n\nСказал санитар (цитировать только дословно):\nКуда сегодня идти?",
      },
    ]);
  });

  test("a first greeting is a single user message, not an empty history dump", () => {
    const messages = dialogueTurnMessages([], "Цикл: 1", "Здорово.");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
    expect(messages[0]?.content).toContain("Здорово.");
  });
});

describe("dialogue world rules", () => {
  test("RU and EN both forbid claiming a physical action unless the tool returned ok", () => {
    const ru = dialogueWorldRules("ru");
    const en = dialogueWorldRules("en");
    expect(ru).toContain(
      "Never claim a physical action unless the matching tool returned ok",
    );
    expect(en).toContain(
      "Never claim a physical action unless the matching tool returned ok",
    );
    expect(ru).toContain("Tools are the body; action is mime only");
    expect(en).toContain("Tools are the body; action is mime only");
    expect(en).toContain("Do not say the door opened if open refused");
  });
});
