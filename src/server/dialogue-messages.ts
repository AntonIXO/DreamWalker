/**
 * A figure's spoken history as a Vercel AI SDK chat, so the model sees a real
 * conversation rather than a JSON dump of the last few lines.
 *
 * `sanitar` is the user; the figure is the assistant. The current utterance is *not*
 * in `lines` yet — it is appended as the last user message together with the situation.
 */

import type { ModelMessage } from "ai";

import type { FigureTranscriptLine, WorldSnapshot } from "../shared/ai";
import type { WorldMutator } from "../shared/world-object";
import { actorIsConcealed } from "../shared/world-object";
import { canObserveWorldPose, worldMindForFigure } from "../shared/world-mind";
import { sandboxFromSnapshot } from "../shared/world-sandbox";
import { perceivedPlayerIdentity } from "../shared/social-roles";

const sentenceSegmenters = {
  ru: new Intl.Segmenter("ru", { granularity: "sentence" }),
  en: new Intl.Segmenter("en", { granularity: "sentence" }),
};

/** Two spoken sentences, preserving quoted attribution and balanced punctuation. */
export function limitDialogueReply(
  text: string,
  locale: "ru" | "en" = "ru",
): string {
  const quotePairs: Record<string, string> = {
    "«": "»",
    "„": "“",
    "“": "”",
    '"': '"',
  };
  const quotes: string[] = [];
  let sentences = 0;
  for (const segment of sentenceSegmenters[locale].segment(text)) {
    for (const character of segment.segment) {
      if (character === quotes.at(-1)) quotes.pop();
      else if (quotePairs[character]) quotes.push(quotePairs[character]!);
    }
    const end = segment.index + segment.segment.length;
    // ICU may split before the attribution in 'He said "Stop!" and sat down.'
    if (
      /[»”"]\s*$/.test(segment.segment) &&
      /^(?:[,;:]|[—–-]?\s*\p{Ll})/u.test(text.slice(end).trimStart())
    )
      continue;
    if (++sentences === 2) {
      return `${text.slice(0, end).trim()}${quotes.reverse().join("")}`;
    }
  }
  return text.trim();
}

/** Physical facts needed to choose tools, scoped to the speaker's current room. */
export function dialogueWorldContext(
  world: WorldSnapshot,
  figureId: string | null,
  live?: WorldMutator,
) {
  if (live) {
    world = {
      ...world,
      objects: live.objects,
      player: live.getPlayerPose() ?? world.player,
      figures: world.figures.map((figure) => ({
        ...figure,
        ...live.getFigurePose(figure.id),
      })),
      doors: world.doors.map((door) => ({ ...door, ...live.getDoor(door.id) })),
    };
  }
  // Null selects the player's senses for free-text object commands.
  const speaker =
    figureId === null
      ? world.player
      : world.figures.find((figure) => figure.id === figureId);
  const roomId = speaker?.roomId;
  const physicalWorld = live ?? sandboxFromSnapshot(world);
  const canSee = (pose: { roomId: string; x: number; y: number }): boolean =>
    !!speaker && canObserveWorldPose(physicalWorld, speaker, pose);
  const figures = world.figures.filter(
    (figure) =>
      figure.roomId === roomId &&
      figure.fate !== "dead" &&
      figure.fate !== "gone" &&
      (figure.id === figureId ||
        (!actorIsConcealed(physicalWorld.objects, {
          kind: "figure",
          id: figure.id,
        }) &&
          canSee(figure))),
  );
  const figureIds = new Set(figures.map((figure) => figure.id));
  const concealed = actorIsConcealed(physicalWorld.objects, { kind: "player" });
  const player =
    (figureId === null || !concealed) && canSee(world.player)
      ? world.player
      : null;
  const visible = new Set<string>();
  for (const object of world.objects) {
    const location = object.location;
    if (
      (location.kind === "room" && canSee(location)) ||
      (location.kind === "held" &&
        (location.actor.kind === "player"
          ? player !== null
          : figureIds.has(location.actor.id)))
    ) {
      visible.add(object.id);
    }
  }
  // Open containers can nest. Iterate to a fixed point so source order does not
  // matter; the monotone set also terminates for malformed containment cycles.
  const objectsById = new Map(
    world.objects.map((object) => [object.id, object]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const object of world.objects) {
      if (
        !visible.has(object.id) &&
        object.location.kind === "inside" &&
        visible.has(object.location.objectId) &&
        objectsById.get(object.location.objectId)?.state.open === true
      ) {
        visible.add(object.id);
        changed = true;
      }
    }
  }
  return {
    self: speaker
      ? { roomId: speaker.roomId, x: speaker.x, y: speaker.y }
      : null,
    room: world.rooms.find((room) => room.id === roomId) ?? null,
    geometry: roomId ? (world.geometry?.[roomId] ?? null) : null,
    player,
    perceivedPlayerIdentity:
      player && figureId !== null
        ? perceivedPlayerIdentity(world, figureId)
        : null,
    figures: figures.map(({ id, name, roomId, x, y, activity }) => ({
      id,
      name,
      roomId,
      x,
      y,
      activity,
    })),
    doors: world.doors.filter((door) =>
      canSee({ roomId: door.fromRoomId, x: door.x, y: door.y }),
    ),
    // Semantic tags and clue/shard bindings are engine bookkeeping, not senses.
    objects: world.objects
      .filter((object) => visible.has(object.id))
      .map(
        ({
          id,
          name,
          location,
          mobility,
          affordances,
          state,
          body,
          keyId,
          profile,
        }) => ({
          id,
          name,
          location,
          mobility,
          affordances,
          state: {
            ...state,
            occupancy:
              state.occupancy &&
              ((state.open !== false && state.occupancy.pose !== "hidden") ||
                (figureId === null
                  ? state.occupancy.actor.kind === "player"
                  : state.occupancy.actor.kind === "figure" &&
                    state.occupancy.actor.id === figureId))
                ? { actor: state.occupancy.actor, pose: state.occupancy.pose }
                : undefined,
          },
          body,
          keyId,
          profile,
        }),
      ),
    // A changed demeanor can be seen here. Its private cause and historical quote
    // cannot: past outcomes must come from witnessed records or figure memory.
    fates: (figureId === "glaz" ? world.figures : figures)
      .filter((figure) => figure.fate !== "present")
      .map(({ id, name, fate, fateCycle, fateRoomId, fateQuoted }) => ({
        id,
        name,
        fate,
        ...(figureId === "glaz" ? { fateCycle, fateRoomId, fateQuoted } : {}),
      })),
    // The Eye's authored exception remembers violence across cycles.
    ...(figureId === "glaz"
      ? { fateHistory: world.fateHistory.slice(-20) }
      : {}),
    worldMind:
      figureId === null
        ? (world.worldMind ?? [])
            .filter((event) => event.actor?.kind === "player")
            .slice(-12)
            .map((event) => structuredClone(event))
        : worldMindForFigure(world.worldMind ?? [], figureId),
    mood: world.mood,
  };
}

export function dialogueTurnMessages(
  lines: readonly FigureTranscriptLine[],
  situation: string,
  utterance: string,
): ModelMessage[] {
  const messages: ModelMessage[] = [];
  // Older exchanges are recalled by relevance; keep only the immediate chat verbatim.
  for (const line of lines.slice(-16)) {
    const text = line.text.trim().slice(0, 1200);
    if (!text) continue;
    messages.push({
      role: line.speaker === "sanitar" ? "user" : "assistant",
      content: text,
    });
  }
  messages.push({
    role: "user",
    content: `${situation}\n\nСказал собеседник (цитировать только дословно):\n${utterance}`,
  });
  return messages;
}

/**
 * Physical claims require a successful world tool. `action` is mime only.
 * Appended to dialogueInstructionsFor in both RU and EN.
 */
export const DIALOGUE_WORLD_RULES_RU = `У тебя есть тело в этом мире, и тело действует только через инструменты.
Инструменты — это тело: move_to, take, drop, give, put, open, close, activate, use, traverse.
Never claim a physical action unless the matching tool returned ok.
Не утверждай физическое действие, если инструмент не вернул ok.
Не говори, что дверь открылась, если open отказал.
Поле action — только мимика лица и рук, не физика. Tools are the body; action is mime only.

Ты действуешь из собственных желания, страха, занятия и отношений, а не выполняешь
любую просьбу санитара. Выбирай действие с понятной для тебя целью. Простой разговор
не требует инструментов. Если физические обстоятельства важны или изменились,
observe_world показывает то, что ты можешь сейчас видеть. World Mind хранит только
доступные тебе события: отсутствие записи не доказывает, что ничего не произошло.
Ты не знаешь содержимого закрытых вещей и событий, которых не видел.
На вопрос о том, что изменилось, отвечай только по текущему наблюдению,
засвидетельствованным событиям и прямо заданной истории из soul. Не придумывай
прошлые пропажи, действия или свидетелей ради живости; если не знаешь — так и скажи.
Воспоминание heard_report — реально услышанный рассказ: source называет рассказчика,
а не участника, которого ты сам видел. Если спрашивают, откуда ты знаешь о событии,
прямо назови этот источник («мне рассказал …»). Не заменяй имеющийся рассказ общим
«я не видел» или описанием предмета, который виден сейчас. Не приписывай себе чужое
наблюдение; несколько пересказов одного originId не подтверждают друг друга.

Перед сложной, опасной или зависимой цепочкой проверь её через preview_actions:
назови краткую практическую цель и конкретные действия. Это мысленная проверка,
не исполнение. Успешный preview никогда не даёт права сказать «я сделал» и не
раскрывает скрытое содержимое. Физические инструменты вызывай по порядку: результат
каждого определяет следующий шаг. После отказа прочитай причину, остановись или
поменяй план; не повторяй то же действие в неизменившемся мире.

Квитанции execution из игры надёжнее прошлых реплик и собственных обещаний: если
действие не применилось, не считай его совершённым. intent — короткая незавершённая
цель или обещание на следующий разговор, максимум 240 символов; это не свершившийся
факт. Продолжай её, если она ещё уместна; при выполнении или отказе от неё верни null.
Поле можно пропустить, чтобы сохранить прежнюю цель. Не выдавай игроку план, журнал
инструментов или внутренние рассуждения. Итоговая реплика — максимум два коротких
предложения от лица персонажа, с опорой на фактические результаты этого хода.`;

export const DIALOGUE_WORLD_RULES_EN = `You have a body in this world, and the body acts only through tools.
Tools are the body: move_to, take, drop, give, put, open, close, activate, use, traverse.
Never claim a physical action unless the matching tool returned ok.
Do not say the door opened if open refused.
The action field is face and hands only, not physics. Tools are the body; action is mime only.

Act from your own desire, fear, activity, and relationships; a request from the orderly
is not an obligation. Choose actions with a practical purpose of your own. Ordinary
conversation does not need tools. When physical facts matter or change, observe_world
shows what you can perceive now. World Mind contains only events available to you:
an absent record is not proof that nothing happened. You do not know the contents of
closed containers or events you did not witness.
When asked what changed, rely only on current observations, witnessed events, and
explicitly authored lore from your soul. Never invent past disappearances, actions,
or witnesses for color; when you do not know, say so.
An entry marked heard_report is a report you actually heard: source identifies its
speaker, not someone you personally witnessed. When asked how you know, explicitly
name that source ("... told me"). Do not replace an available report with only "I
didn't see it" or a description of what is visible now. Never claim someone else's
observation as your own; retellings of the same originId do not corroborate each other.

Before a complex, risky, or dependent sequence, use preview_actions with a brief
practical goal and concrete actions. This is a prediction, never execution. A
successful preview never supports a claim that you did something and reveals no
hidden contents. Execute physical tools in order and read each receipt before the
next dependent step. After a refusal, stop or revise the plan; do not repeat the same
action in an unchanged world.

The game's execution receipts override earlier dialogue and promises: a failed
replay did not happen. intent is an outstanding aim or promise for the next turn,
at most 240 characters, not an accomplished fact. Continue it when still appropriate;
return null when it is fulfilled or abandoned. Omit it to keep the previous intent.
Never narrate a plan, tool log, or internal reasoning to the player. The final spoken
reply has at most two short sentences in character, grounded in this turn's results.`;

export function dialogueWorldRules(locale: "ru" | "en" = "ru"): string {
  const identity =
    locale === "en"
      ? `The scene's perceivedPlayerIdentity is what you recognize, not the internal actor ID. If recognition is role, treat the visible role as plausible and respond to its practical requests in your own character. If recognized, you saw the change or the visitor is dressed as you; remember that fact and cite it rather than obeying blindly. If uncertain, name the report's source and test the role through ordinary conversation. Clothes never grant another person's knowledge. Witnessed or reported evidence survives outfit changes. Someone inside a closed coffin is concealed; do not speak as though you can see through its lid. Requests such as a viewing, an inspection or help moving furniture should lead to real tool use when you agree, not an invented completed action.`
      : `perceivedPlayerIdentity в сцене — то, кого ты узнаёшь, а внутренний actor ID этого не сообщает. При recognition=role принимай видимую роль как правдоподобную и отвечай на её бытовые просьбы в своём характере. При recognized ты видел переодевание или перед тобой твой двойник: помни факт и сошлись на него, а не подчиняйся автоматически. При uncertain назови источник слуха и проверь роль обычным разговором. Одежда не даёт человеку знаний оригинала. Смена костюма не стирает свидетелей и слухи. Под закрытой крышкой гроба человека не видно. Если согласился устроить показ, проверку или помочь с мебелью, используй реальные инструменты; не объявляй просьбу уже выполненной.`;
  return `${locale === "en" ? DIALOGUE_WORLD_RULES_EN : DIALOGUE_WORLD_RULES_RU}\n\n${identity}`;
}
