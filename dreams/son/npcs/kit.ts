import type { DialogueResult, Tell } from "../../../src/shared/ai";
import type { PortraitState } from "../../../src/shared/content";
import type { FigureTalkContext } from "../../../src/shared/pack";

export const ADMITS =
  /зачем|забрал|битк|кошел|сид|деньг|фраз|укра|вор|санитар|снаруж|мнемон/iu;
export const BUSINESS =
  /куда|кто|слово|зацеп|ключ|комнат|идти|делать|секрет|найт/iu;
export const IDLE = /погод|музык|песн|ладно|сижу|сядь|как дела|нормальн/iu;
export const PITY = /жалк|больн|болит|тебе как|ты как|бедн|держ/iu;
export const RECOGNISE = /призна|прав был|молодец|круто|придумал|заслуг/iu;
export const DEATH = /убил|мертв|умер|убива|вернул/iu;
export const MONEY = /деньг|рубл|доллар|битк|кошел|сумм|поезд|кинул/iu;

export function has(said: string, re: RegExp): boolean {
  return re.test(said);
}

export function hasAny(said: string, stems: readonly string[]): boolean {
  return stems.some((stem) => said.includes(stem));
}

export function quote(utterance: string, stem: string): string {
  const words = utterance.split(/[^\p{L}\p{N}-]+/u).filter(Boolean);
  return words.find((word) => word.toLowerCase().includes(stem)) ?? stem;
}

export function tellOn(
  utterance: string,
  stems: readonly string[],
): Tell | null {
  const hit = stems.find((stem) => utterance.toLowerCase().includes(stem));
  return hit ? { quoted: quote(utterance, hit) } : null;
}

export function say(
  reply: string,
  extra: Partial<DialogueResult> = {},
): DialogueResult {
  return {
    reply: reply.slice(0, 180),
    action: extra.action ?? null,
    tell: extra.tell ?? null,
    yieldedShardId: extra.yieldedShardId ?? null,
    residueDelta: extra.residueDelta ?? [],
    memoryEffect: extra.memoryEffect ?? null,
    resonance: extra.resonance ?? null,
    figureMemorySummary: extra.figureMemorySummary ?? "",
    journalEntry: extra.journalEntry ?? null,
    portraitState: extra.portraitState ?? "neutral",
    leverageLearned: extra.leverageLearned ?? null,
    pressed: extra.pressed ?? null,
  };
}

export function bump(
  ctx: FigureTalkContext,
  next: PortraitState,
): PortraitState {
  const order: PortraitState[] = ["neutral", "interested", "wary", "knows"];
  const now = order.indexOf(ctx.portrait);
  const want = order.indexOf(next);
  return order[Math.max(now, want)] ?? ctx.portrait;
}

export function count(ctx: FigureTalkContext, key: string): number {
  const next = Number(ctx.getFlag(key) ?? 0) + 1;
  ctx.setFlag(key, next);
  return next;
}

export function pick(ctx: FigureTalkContext, lines: readonly string[]): string {
  const i = Math.abs(ctx.conversationTurns + ctx.said.length) % lines.length;
  return lines[i]!;
}
