import { describe, expect, test } from "bun:test";

import { dialogueTurnMessages } from "./dialogue-messages";

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
