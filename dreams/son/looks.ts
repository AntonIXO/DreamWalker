import type { ExamineResult } from "../../src/shared/ai";

const LINES: Record<string, string> = {
  nadpis: "Никогда не верьте маме, она не сдерживает свои обещания!",
  iacheika: "Деньги видны. До них двадцать сантиметров. Таймер считает вверх.",
  zapiska: "Чтобы была мотивация. Тем же почерком, что в шкафу.",
  paket: "Ледяной. Рука не вынимается. Крови на полу нет.",
  noutbuk: "Курсор в незакрытой скобке. Строка дописывается сама.",
  ekran: "Двенадцать квадратов. Твой чуть светлее остальных чёрных.",
  schet: "Триста. Валюта смазана. Можно прочитать и рубль, и доллар.",
  "figura-na-beregu": "Девяносто метров, которые ходят только по кругу.",
  "urna-nabitaia-akkuratno":
    "В урне что-то бумажное, сложенное слишком ровно для мусора.",
  "piat-tysiach-nalichnymi-kotorye-uzhe-otd":
    "Пять тысяч уже не лежат. Лежит чувство, что их отдали не туда.",
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
