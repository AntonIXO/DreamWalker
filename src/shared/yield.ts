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

const ADMITS_PURPOSE =
  /зачем|забрал|битк|кошел|сид|деньг|фраз|укра|вор|санитар|снаруж|модел|мнемон/iu;
const RECOGNISES_KIRILL = /призна|прав был|молодец|круто|придумал|заслуг/iu;
const ASKS_PAPA = /совет|как\b|почему|надо\b|что делать|жоп/iu;
const HEARD_THE_HALL = /канат|бассейн|смех|тишин|этаж/iu;

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
