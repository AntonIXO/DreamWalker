/**
 * The sealed phrase is twelve BIP-39 English words. The engine — not the model —
 * decides whether what the sanitar typed is even a phrase, before it is allowed to
 * be the secret.
 */

import { validateMnemonic, wordlists } from "bip39";

export function normalisePhraseWords(words: readonly string[]): string[] {
  return words.map((word) => word.normalize("NFKD").trim().toLowerCase());
}

export function isWellFormedPhrase(words: readonly string[]): boolean {
  const normalised = normalisePhraseWords(words);
  if (normalised.length !== 12 || !normalised.every(Boolean)) return false;
  return validateMnemonic(normalised.join(" "), wordlists.english);
}
