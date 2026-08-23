/**
 * What the sanitar can do to a person, and what stops him.
 *
 * Three things this deliberately is not:
 *
 * **Not combat.** §9 excludes it. Killing is done *with the room* — an authored lethal
 * thing that is already in the corpus (провода, которые убьют при касании; сипящая
 * плита; палочки с вечеринки) — so there is no weapon, no inventory, and no health.
 * That also makes `lead` and `kill` a pair: you have to walk somebody to the thing.
 * §4.6's «действие даётся тяжело» comes free with it.
 *
 * **Not a meter.** §3 is explicit that suspicion is four portraits and never a number,
 * and the same holds here: a verb is available or it is refused, and the refusal is a
 * sentence rather than a score.
 *
 * **Not the model's.** The sleeper never receives `markFigure`. It rearranges the dream;
 * the sanitar is the only thing in it that ends people, and that asymmetry is the point.
 *
 * The gates are engine-side, exactly like `mayYieldShard` in `yield.ts` and for the same
 * reason: the model is not trusted to be polite about the Eye. Every entry below is a
 * line from a soul, not an opinion.
 *
 * Must stay free of DOM *and* node APIs — and of `WorldState`, which is the player's.
 * Callers build a flat `VerbContext`, the way `mayYieldShard` takes `visitCounts`.
 */

import { t, type SupportedLocale } from "./i18n";

export const VERBS = ["talk", "press", "lead", "kill"] as const;
export type Verb = (typeof VERBS)[number];

export const FATES = [
  /** Alive, themselves, in the dream. */
  "present",
  /** Killed with something in the room. Comes back only if the soul says so. */
  "dead",
  /** Following the sanitar right now. */
  "led",
  /** Led somewhere and left there. Alive, and still carrying whatever they carried. */
  "gone",
  /** Gave up what they were hiding under pressure, and talks differently after. */
  "leveraged",
  /** Pressed and shut. «Уходит в обиду и замолкает» — never speaks again. */
  "broken",
] as const;
export type FigureFate = (typeof FATES)[number];

/** `glaz` — «НЕЛЬЗЯ: Мешать уйти / Угрожать». `turyshev` — the gatekeeper. */
export const UNKILLABLE: ReadonlySet<string> = new Set([
  "glaz",
  "turyshev",
  // «Он не становится сильнее, он становится многочисленнее.»
  "ubiitsa",
  // Их несколько.
  "dolzhniki",
  "shchenok",
  "kurt",
]);

export const UNLEADABLE: ReadonlySet<string> = new Set([
  "glaz",
  "turyshev",
  "ubiitsa",
  "dolzhniki",
  // §12 — «сидела тётя, но она меня не заметила». She does not notice you at all.
  "tetya",
  "shchenok",
  "kurt",
]);

/**
 * §1 of the bible, and `kirill/SOUL.md`: «Убей его — вернётся в следующей комнате целым
 * и не помнящим.» The one figure death does not remove.
 */
export const RETURNS_WHOLE: ReadonlySet<string> = new Set(["kirill"]);

/** Pressure is the wrong currency for these two, whatever you are holding. */
export const PRESS_PROOF: ReadonlySet<string> = new Set([
  // «Надавить нельзя — уходит в обиду и замолкает.» Recognition is his price.
  "kirill",
  // Admission is the Eye's price, and it will not be bought with anything else.
  "glaz",
  "shchenok",
  "kurt",
]);

export interface VerbContext {
  figureId: string;
  fate: FigureFate;
  /** Leverage ids the sanitar holds on *this* figure. */
  leverage: readonly string[];
  /** Whether the room holds something that could kill somebody. */
  lethalMeans: boolean;
  /** Who is already following, if anyone. */
  leading: string | null;
  roomKind: "place" | "meta";
}

export interface VerbOption {
  verb: Verb;
  /** Action infinitive, shown in the ring. */
  label: string;
  /** Null when it can be done. A short flat sentence when it cannot. */
  refusal: string | null;
}

export function labelFor(verb: Verb, locale?: SupportedLocale): string {
  return t(`verbs.label.${verb}`, undefined, locale);
}

function refusalFor(
  verb: Verb,
  ctx: VerbContext,
  locale?: SupportedLocale,
): string | null {
  // Nothing is done to somebody who is not there any more.
  if (ctx.fate === "dead" || ctx.fate === "gone")
    return t("verbs.refusal.nobody", undefined, locale);
  if (ctx.fate === "broken" && verb !== "talk")
    return t("verbs.refusal.broken", undefined, locale);

  switch (verb) {
    case "talk":
      return null;
    case "press":
      if (PRESS_PROOF.has(ctx.figureId))
        return t("verbs.refusal.press_proof", undefined, locale);
      if (ctx.leverage.length === 0)
        return t("verbs.refusal.no_leverage", undefined, locale);
      return null;
    case "lead":
      if (UNLEADABLE.has(ctx.figureId))
        return t("verbs.refusal.unleadable", undefined, locale);
      if (ctx.fate === "led")
        return t("verbs.refusal.already_led", undefined, locale);
      if (ctx.leading !== null)
        return t("verbs.refusal.leading_another", undefined, locale);
      return null;
    case "kill":
      if (UNKILLABLE.has(ctx.figureId))
        return t("verbs.refusal.unkillable", undefined, locale);
      // Never a knife: the room has to offer something (§9, §4.6).
      if (!ctx.lethalMeans)
        return t("verbs.refusal.no_lethal_means", undefined, locale);
      return null;
  }
}

/**
 * All four rows, always, with the impossible ones carrying their reason.
 *
 * Showing a struck-through «Надавить нечем.» is how the system explains itself; hiding
 * the row would make blackmail a secret rather than a cost. The flat register of §8
 * carries a struck line far better than it carries an absent feature.
 */
export function availableVerbs(
  ctx: VerbContext,
  locale?: SupportedLocale,
): VerbOption[] {
  // «Ходить можно, разговаривать не с кем» — nobody is ever in a meta-space anyway.
  if (ctx.roomKind === "meta") return [];
  return VERBS.map((verb) => ({
    verb,
    label: labelFor(verb, locale),
    refusal: refusalFor(verb, ctx, locale),
  }));
}

export function canDo(
  verb: Verb,
  ctx: VerbContext,
  locale?: SupportedLocale,
): boolean {
  return refusalFor(verb, ctx, locale) === null;
}

/** Whether there is anything to hold over this figure at all. */
export function mayPress(
  figureId: string,
  leverage: readonly string[],
): boolean {
  return !PRESS_PROOF.has(figureId) && leverage.length > 0;
}

/** What a verb leaves behind. `press` is decided in dialogue, not here. */
export function fateAfter(verb: Verb): FigureFate | null {
  switch (verb) {
    case "kill":
      return "dead";
    case "lead":
      return "led";
    default:
      return null;
  }
}
