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

/**
 * Physical claims require a successful world tool. `action` is mime only.
 * Appended to dialogueInstructionsFor in both RU and EN.
 */
export const DIALOGUE_WORLD_RULES_RU = `У тебя есть тело в этом мире, и тело действует только через инструменты.
Инструменты — это тело: move_to, take, drop, give, put, open, close, activate, use, traverse.
Never claim a physical action unless the matching tool returned ok.
Не утверждай физическое действие, если инструмент не вернул ok.
Не говори, что дверь открылась, если open отказал.
Поле action — только мимика лица и рук, не физика. Tools are the body; action is mime only.`;

export const DIALOGUE_WORLD_RULES_EN = `You have a body in this world, and the body acts only through tools.
Tools are the body: move_to, take, drop, give, put, open, close, activate, use, traverse.
Never claim a physical action unless the matching tool returned ok.
Do not say the door opened if open refused.
The action field is face and hands only, not physics. Tools are the body; action is mime only.`;

export function dialogueWorldRules(locale: "ru" | "en" = "ru"): string {
  return locale === "en" ? DIALOGUE_WORLD_RULES_EN : DIALOGUE_WORLD_RULES_RU;
}
