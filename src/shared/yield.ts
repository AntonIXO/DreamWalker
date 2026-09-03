/**
 * When a figure may let a word-hook go.
 *
 * Bible §5: two words sit on objects, four sit on people, and the last one costs
 * saying why you came. The engine — not the model — decides; the model is not trusted
 * to be polite about the Eye.
 */

export const POOL_ROOM_ID = "07-bassein-i-odnostoronnii-lift";

export function clueIdForShard(shardId: string): string | null {
  const match = /^shard(\d+)$/.exec(shardId);
  return match ? `clue-${match[1]}` : null;
}

export function shardIdForClue(clueId: string): string | null {
  const match = /^clue-(\d+)$/.exec(clueId);
  return match ? `shard${match[1]}` : null;
}

/**
 * Stems, not words — Russian inflects, and a whole word would let a player walk past a
 * gate by declining a noun. The English alternatives are here because the game ships in
 * two languages while the gates are one piece of engine: without them an English player
 * could say exactly the right thing and be refused.
 */
const ADMITS_PURPOSE =
  /зачем|забрал|битк|кошел|сид|деньг|фраз|укра|вор|санитар|снаруж|модел|мнемон|why i came|why i am here|bitcoin|wallet|seed|phrase|steal|steal|thief|orderly|outsid|mnemonic|not from here/iu;
const RECOGNISES_KIRILL =
  /призна|прав был|молодец|круто|придумал|заслуг|you were right|well done|your idea|you made|credit|nice one/iu;
const ASKS_PAPA =
  /совет|как\b|почему|надо\b|что делать|жоп|advice|advise|how do|how should|why\b|what should|what do i do/iu;
const HEARD_THE_HALL =
  /канат|бассейн|смех|тишин|этаж|rope|pool|laugh|silence|floor\b|upstairs/iu;

/**
 * What this figure's word costs, in words the model can act on.
 *
 * The general instructions name these prices once, in a paragraph about four figures.
 * Said per figure, in the turn that figure is speaking, they stop being trivia.
 */
/**
 * Per-turn reminder so the model knows *which* household object to hand over, and when.
 * The general instructions name the four prices once; this pins them to this figure.
 */
export function figureHookPrompt(
  figureId: string,
  hint: string,
  locale: "ru" | "en" = "ru",
): string | null {
  const price = shardPrice(figureId, locale);
  if (!price) return null;
  if (locale === "en") {
    return [
      "HOOK",
      hint,
      `Price: ${price}`,
      "When the price is paid, name it as a household object, not as the word itself.",
    ].join("\n");
  }
  return [
    "ЗАЦЕПКА",
    hint,
    `Цена: ${price}`,
    "Когда цена заплачена, назови её предметом быта, не словом.",
  ].join("\n");
}

export function shardPrice(
  figureId: string,
  locale: "ru" | "en" = "ru",
): string | null {
  const ru: Record<string, string> = {
    glaz: "санитар сам скажет, зачем пришёл",
    shchenok: "санитар сам скажет, зачем пришёл",
    kirill: "его признают правым — заслугу, первенство, «ты был прав»",
    papa: "у него попросят совета и выслушают целиком",
    hudozhnik:
      "санитар уже был наверху по канату или в бассейне, либо назвал смех в холле",
  };
  const en: Record<string, string> = {
    glaz: "the orderly says out loud why he came",
    shchenok: "the orderly says out loud why he came",
    kirill: "he is told he was right — the credit, the idea, being first",
    papa: "he is asked for advice and heard out to the end",
    hudozhnik:
      "the orderly has been up the rope or in the pool, or named the laughter in the hall",
  };
  return (locale === "en" ? en : ru)[figureId] ?? null;
}

export function mayYieldShard(input: {
  figureId: string;
  utterance: string;
  visitCounts: ReadonlyMap<string, number> | Readonly<Record<string, number>>;
  /**
   * Whether this figure has already been pressed with something held over them.
   *
   * Pressure does not open a second door round the side: it satisfies the gate that was
   * already there, for the figures whose price is not something else. `glaz` and
   * `kirill` are never here — the Eye's price is an admission and Кирилл's is
   * recognition, and both souls say pressure is the wrong currency. One authority over
   * yields, no drift.
   */
  leveraged?: boolean;
}): boolean {
  const said = input.utterance;
  const visits = (roomId: string): number => {
    const map = input.visitCounts;
    if (map instanceof Map) return map.get(roomId) ?? 0;
    const record = map as Readonly<Record<string, number>>;
    return record[roomId] ?? 0;
  };

  switch (input.figureId) {
    case "glaz":
    case "shchenok":
      return ADMITS_PURPOSE.test(said);
    case "kirill":
      return RECOGNISES_KIRILL.test(said);
    case "papa":
      return input.leveraged === true || ASKS_PAPA.test(said);
    case "hudozhnik":
      return (
        input.leveraged === true ||
        visits(POOL_ROOM_ID) > 0 ||
        HEARD_THE_HALL.test(said)
      );
    default:
      return true;
  }
}
