/**
 * A figure's spoken history as a Vercel AI SDK chat, so the model sees a real
 * conversation rather than a JSON dump of the last few lines.
 *
 * `sanitar` is the user; the figure is the assistant. The current utterance is *not*
 * in `lines` yet — it is appended as the last user message together with the situation.
 */

import type { ModelMessage } from "ai";

import type { FigureTranscriptLine } from "../shared/ai";

export function dialogueTurnMessages(
  lines: readonly FigureTranscriptLine[],
  situation: string,
  utterance: string,
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    messages.push({
      role: line.speaker === "sanitar" ? "user" : "assistant",
      content: text,
    });
  }
  messages.push({
    role: "user",
    content: `${situation}\n\nСказал санитар (цитировать только дословно):\n${utterance}`,
  });
  return messages;
}
