/**
 * Terminal input for the Lord's tools.
 *
 * Every command here can also run non-interactively — pass the answers as flags and
 * nothing blocks. That is what lets the whole authoring flow run in a script or a test
 * without a human at the keyboard.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const ESC = "\x1b[";

export const color = {
  reset: (s: string) => `${ESC}0m${s}${ESC}0m`,
  bold: (s: string) => `${ESC}1m${s}${ESC}22m`,
  dim: (s: string) => `${ESC}2m${s}${ESC}22m`,
  red: (s: string) => `${ESC}31m${s}${ESC}39m`,
  green: (s: string) => `${ESC}32m${s}${ESC}39m`,
  yellow: (s: string) => `${ESC}33m${s}${ESC}39m`,
  blue: (s: string) => `${ESC}34m${s}${ESC}39m`,
  magenta: (s: string) => `${ESC}35m${s}${ESC}39m`,
  cyan: (s: string) => `${ESC}36m${s}${ESC}39m`,
  grey: (s: string) => `${ESC}90m${s}${ESC}39m`,
};

export function heading(text: string): void {
  console.log(`\n${color.bold(text)}`);
  console.log(color.grey("─".repeat(Math.max(text.length, 24))));
}

export function note(text: string): void {
  console.log(color.grey(`  ${text}`));
}

export function ok(text: string): void {
  console.log(`${color.green("✓")} ${text}`);
}

export function warn(text: string): void {
  console.log(`${color.yellow("!")} ${text}`);
}

export function isInteractive(): boolean {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

export async function ask(question: string, fallback = ""): Promise<string> {
  if (!isInteractive()) return fallback;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = fallback ? color.grey(` (${fallback})`) : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

export async function askRequired(
  question: string,
  fallback = "",
): Promise<string> {
  for (;;) {
    const answer = await ask(question, fallback);
    if (answer) return answer;
    if (!isInteractive()) throw new Error(`${question} is required`);
    warn("that one is not optional");
  }
}

/** A single keypress, lowercased. Ctrl-C exits, as it should everywhere. */
export async function readKey(): Promise<string> {
  if (!isInteractive()) return "";
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise<string>((resolve) => {
    const onData = (buffer: Buffer): void => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      const raw = buffer.toString("utf8");
      if (raw === "\u0003") {
        console.log();
        process.exit(130);
      }
      resolve(raw.toLowerCase());
    };
    stdin.on("data", onData);
  });
}

/** Waits for one of `keys`, re-prompting on anything else. */
export async function readOneOf(
  keys: readonly string[],
  prompt: string,
): Promise<string> {
  if (!isInteractive()) return keys[0]!;
  for (;;) {
    stdout.write(`${prompt} `);
    const key = await readKey();
    if (keys.includes(key)) {
      stdout.write(`${key}\n`);
      return key;
    }
    stdout.write(`${color.grey("?")}\n`);
  }
}

export interface Option<T> {
  label: string;
  value: T;
  detail?: string;
}

/** Numbered pick list. Returns the first option when there is nobody to ask. */
export async function choose<T>(
  question: string,
  options: ReadonlyArray<Option<T>>,
  fallbackIndex = 0,
): Promise<T> {
  if (options.length === 0) throw new Error("choose() with no options");
  if (!isInteractive()) return options[fallbackIndex]!.value;

  console.log(`\n${question}`);
  options.forEach((option, i) => {
    const detail = option.detail ? color.grey(`  ${option.detail}`) : "";
    console.log(`  ${color.bold(String(i + 1))}. ${option.label}${detail}`);
  });

  const keys = options.map((_, i) => String(i + 1));
  const key = await readOneOf(keys, color.grey(`pick 1-${options.length}`));
  return options[Number(key) - 1]!.value;
}

export async function confirm(
  question: string,
  fallback = true,
): Promise<boolean> {
  if (!isInteractive()) return fallback;
  const key = await readOneOf(["y", "n"], `${question} ${color.grey("[y/n]")}`);
  return key === "y";
}
