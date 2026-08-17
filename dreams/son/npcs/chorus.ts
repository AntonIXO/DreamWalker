import type { DialogueResult } from "../../../src/shared/ai";
import type { FigureAi, FigureTalkContext } from "../../../src/shared/pack";
import { ADMITS, BUSINESS, bump, pick, say, tellOn } from "./kit";

const VOICE: Record<string, { lines: string[]; action: string }> = {
  hudozhnik: {
    lines: [
      "Смех есть. Шутки нет. Ты тоже слышишь?",
      "Я уже это рассказывал. Слова выпали.",
    ],
    action: "рот открывается не в такт",
  },
  papa: {
    lines: [
      "А ты сам знаешь, что жопа — это важно.",
      "Тут лечатся все, кто падает. Это лучшая.",
    ],
    action: "говорит чуть громче, чем позволяет кабинет",
  },
  tetya: {
    lines: ["…", "Я не заметила."],
    action: "сидит спиной. не поворачивается",
  },
  "babushka-nadya": {
    lines: ["Ничего здесь брать не стоит.", "Не бери. Я уже говорила."],
    action: "складывает чужое в пакет",
  },
  dolzhniki: {
    lines: ["Ты должен. Что — потом объясним.", "Это ты помог. Вот это."],
    action: "подходят на двадцать сантиметров ближе",
  },
  ubiitsa: {
    lines: ["Сиди.", "Их будет двое. Потом четверо."],
    action: "фары уже на стене, мотора ещё нет",
  },
  "liosha-gnedkov": {
    lines: [
      "Наверное нет, и ты можешь подорваться.",
      "Я сплю. Разбуди, если стена вернётся.",
    ],
    action: "говорит спокойно, как про чужую смерть",
  },
  nilufar: {
    lines: [
      "Обычный разговор. Я не понимаю, чего ты ждёшь.",
      "Окно настоящее. Остальное — нет.",
    ],
    action: "не двигается, пока не заговорят",
  },
  aleksei: {
    lines: ["Ты опять не успел.", "Я ещё здесь. Пока."],
    action: "идёт через холл и не оборачивается",
  },
  "ded-slava": {
    lines: ["Доедай.", "Я никуда не делся."],
    action: "стоит у кромки, как будто его не хоронили",
  },
};

function chorusTalk(id: string, ctx: FigureTalkContext): DialogueResult {
  const voice = VOICE[id] ?? {
    lines: ["Здесь всегда так.", "Ты бы шёл."],
    action: "занят своим",
  };
  const nosy = ADMITS.test(ctx.said) || BUSINESS.test(ctx.said);
  const tell = nosy
    ? tellOn(ctx.utterance, ["кошел", "сид", "куда", "слово", "зачем", "деньг"])
    : null;
  return say(pick(ctx, voice.lines), {
    action: voice.action,
    tell,
    portraitState: bump(ctx, nosy ? "wary" : "interested"),
  });
}

export function chorus(id: string): FigureAi {
  return {
    id,
    talk: (ctx) => chorusTalk(id, ctx),
  };
}
