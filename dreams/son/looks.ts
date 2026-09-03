import type { ExamineResult } from "../../src/shared/ai";

/**
 * What the sanitar sees when the model is not answering.
 *
 * These lines must stay neutral about money. `endings.md` makes the money scenes the
 * one honest signal of whether the wallet is dry, and that signal is decided per run and
 * kept on the server — a line here that leaned either way would answer the question in
 * a file the browser already has. `isMoneyHotspot` sends those hotspots to the server
 * even when a line exists here; these are the training-run stand-ins.
 */
const LINES: Record<string, string> = {
  nadpis: "Никогда не верьте маме, она не сдерживает свои обещания!",
  iacheika: "Стекло, и за ним двадцать сантиметров. Таймер считает вверх.",
  zapiska: "Чтобы была мотивация. Тем же почерком, что в шкафу.",
  paket: "Ледяной. Рука не вынимается. Крови на полу нет.",
  noutbuk: "Курсор в незакрытой скобке. Строка дописывается сама.",
  ekran: "Двенадцать квадратов. Твой чуть светлее остальных чёрных.",
  schet: "Триста. Валюта смазана. Можно прочитать и рубль, и доллар.",
  "figura-na-beregu": "Девяносто метров, которые ходят только по кругу.",
  "urna-nabitaia-akkuratno":
    "В урне что-то бумажное, сложенное слишком ровно для мусора.",
  "piat-tysiach-nalichnymi-kotorye-uzhe-otd":
    "Пять тысяч. Про них здесь говорят так, будто счёт ещё не закрыт.",
};

export function lookAt(
  hotspotId: string | null | undefined,
): ExamineResult | null {
  if (!hotspotId) return null;
  const exact = LINES[hotspotId];
  if (exact) {
    return {
      reply: exact,
      yieldedShardId: null,
      clueObservedId: null,
      leverageLearned: null,
    };
  }
  for (const [key, line] of Object.entries(LINES)) {
    if (hotspotId.endsWith(key) || hotspotId.includes(key)) {
      return {
        reply: line,
        yieldedShardId: null,
        clueObservedId: null,
        leverageLearned: null,
      };
    }
  }
  return null;
}
