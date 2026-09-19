import type { CharacterDefinition } from "../../../src/shared/content";
import { fallbackPortraits } from "../../../src/shared/content";

import anton from "../content/characters/anton.json";
import babushka from "../content/characters/babushka-nadya.json";
import dolzhniki from "../content/characters/dolzhniki.json";
import glaz from "../content/characters/glaz.json";
import hudozhnik from "../content/characters/hudozhnik.json";
import kirill from "../content/characters/kirill.json";
import kripto from "../content/characters/kripto-bro.json";
import liosha from "../content/characters/liosha-gnedkov.json";
import mama from "../content/characters/mama.json";
import nilufar from "../content/characters/nilufar.json";
import papa from "../content/characters/papa.json";
import tetya from "../content/characters/tetya.json";
import turyshev from "../content/characters/turyshev.json";
import ubiitsa from "../content/characters/ubiitsa.json";
import spriteSheets from "../content/assets/sprites/manifest.json";

function extra(
  id: string,
  name: string,
  archetypeId: string,
  fields: Omit<
    CharacterDefinition,
    | "id"
    | "name"
    | "archetypeId"
    | "portraits"
    | "portraitImages"
    | "spriteSheet"
  >,
): CharacterDefinition {
  return {
    id,
    name,
    archetypeId,
    portraits: fallbackPortraits(archetypeId),
    portraitImages: null,
    spriteSheet: spriteSheet(id),
    ...fields,
  };
}

function spriteSheet(id: string): CharacterDefinition["spriteSheet"] {
  return (
    (
      spriteSheets as Record<
        string,
        NonNullable<CharacterDefinition["spriteSheet"]>
      >
    )[id] ?? null
  );
}

const NEW_CARDS: CharacterDefinition[] = [
  extra("raisa", "РАИСА МИХАЙЛОВНА", "watcher", {
    personality:
      "Учительница подготовки. Говорит о пациенте точно, без любви и без обиды.",
    role: "свидетель",
    voice: "медленно, законченными предложениями, на «вы»",
    desire: "чтобы человек услышал про себя правду",
    fear: "не успеть сказать, пока ещё можно",
    taboo: "не говорит того, что человеку сейчас не поднять",
    initialActivity: "сидит за столом и ждёт, пока станет тихо",
    soulPath: "souls/raisa.md",
    suspicionMonotone: true,
    leverageId: "raisa:kharakteristika",
  }),
  extra("lysyi", "ЛЫСЫЙ В APPLE WATCH", "visitor", {
    personality:
      "Делает с санитаром то, что санитар делает с остальными: выясняет, тот ли ты.",
    role: "ненастоящий мент",
    voice: "ровный, негромкий, пауз больше, чем слов",
    desire: "закрыть вопрос и поехать",
    fear: "нет. Ему скучно",
    taboo: "не повышает голос ни разу",
    initialActivity: "стоит у подъезда и смотрит на часы",
    soulPath: "souls/lysyi.md",
    suspicionMonotone: true,
    leverageId: null,
  }),
  extra("kurt", "КУРТ", "child", {
    personality:
      "Виртуальный друг. Знает, что выдуман, и это его устраивает. Приходит, когда кончается.",
    role: "гость",
    voice: "тихо, с паузами, чуть невпопад, по-русски",
    desire: "компании. Просто посидеть рядом",
    fear: "делового тона",
    taboo: "не цитирует песни, не говорит, как умер",
    initialActivity: "сидит на полу у стены, не в центре кадра",
    soulPath: "souls/kurt.md",
    suspicionMonotone: false,
    leverageId: null,
  }),
  extra("ded-slava", "ДЕД СЛАВА", "watcher", {
    personality:
      "Умер, пока внук доигрывал серию. Вернулся без следа, потому что так устроен пациент.",
    role: "дедушка",
    voice: "коротко, бытово, как будто его не хоронили",
    desire: "чтобы внук наконец доел",
    fear: "чтобы его снова не заметили слишком внимательно",
    taboo: "не говорит, что его нет",
    initialActivity: "стоит у кромки леса и смотрит, как несут гроб",
    soulPath: "souls/ded-slava.md",
    suspicionMonotone: true,
    leverageId: null,
  }),
  extra("aleksei", "АЛЕКСЕЙ", "orderly", {
    personality:
      "Тот, кого не успели. В холле он ещё здесь и ещё можно успеть.",
    role: "друг, которого не догнали",
    voice:
      "спокойно, уже всё решил насчёт твоей смерти и просто держит в курсе",
    desire: "чтобы кто-нибудь один раз пришёл вовремя",
    fear: "что снова придётся ждать одному",
    taboo: "не просит спасти его вслух",
    initialActivity: "идёт через холл и не оборачивается",
    soulPath: "souls/aleksei.md",
    suspicionMonotone: true,
    leverageId: "aleksei:ne-uspel",
  }),
  extra("shchenok", "ЩЕНОК", "child", {
    personality:
      "Маленькая собака. Не призрак. Ждёт, когда игру продолжат. Не обвиняет.",
    role: "слой 3",
    voice: "три-пять слов, настоящее время, хорошее настроение",
    desire: "продолжить. В прошлый раз почти получилось",
    fear: "нет шкалы. У него её нет",
    taboo: "ни одного упрёка, ни слова про смерть, ни прощения",
    initialActivity: "лежит на боку, хвост стучит по полу",
    soulPath: "souls/shchenok.md",
    suspicionMonotone: false,
    leverageId: null,
  }),
];

export function allCharacters(): CharacterDefinition[] {
  const existing = [
    anton,
    babushka,
    dolzhniki,
    glaz,
    hudozhnik,
    kirill,
    kripto,
    liosha,
    mama,
    nilufar,
    papa,
    tetya,
    turyshev,
    ubiitsa,
  ] as CharacterDefinition[];
  return [...existing, ...NEW_CARDS].map((character) => ({
    ...character,
    spriteSheet: spriteSheet(character.id),
  }));
}
