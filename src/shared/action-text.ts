import type { WorldAction } from "./world-action";

export function actionLabel(
  action: WorldAction | { type: "examine"; objectId: string },
  locale: "ru" | "en",
): string {
  const labels: Record<string, [string, string]> = {
    examine: ["Осмотреть", "Examine"],
    approach: ["Подойти", "Approach"],
    take: ["Взять", "Take"],
    drop: ["Положить", "Put down"],
    give: ["Передать", "Give"],
    put: ["Положить внутрь", "Put inside"],
    open: ["Открыть", "Open"],
    close: ["Закрыть", "Close"],
    activate: ["Включить", "Activate"],
    use: ["Использовать", "Use"],
    occupy: ["Устроиться внутри", "Settle inside"],
    leave: ["Выбраться", "Get out"],
    wear: ["Надеть", "Put on"],
    removeWear: ["Снять", "Take off"],
    detach: ["Отсоединить", "Detach"],
    empty: ["Вытряхнуть", "Empty"],
    moveObject: ["Сдвинуть", "Move"],
    traverseDoor: ["Пройти", "Go through"],
    moveTo: ["Подойти", "Walk over"],
  };
  if (action.type === "requestRole") {
    const social = {
      gather: ["Собрать зрителей", "Gather an audience"],
      inspect: ["Начать проверку", "Begin an inspection"],
      helpMove: ["Позвать помочь", "Ask for a hand"],
    };
    return social[action.intent][locale === "en" ? 1 : 0]!;
  }
  return (
    labels[action.type]?.[locale === "en" ? 1 : 0] ??
    (locale === "en" ? "Act" : "Сделать")
  );
}

/** Describe only a confirmed effect; social requests do not imply compliance. */
export function actionSuccessText(
  action: WorldAction,
  locale: "ru" | "en",
): string {
  const lines: Record<string, [string, string]> = {
    approach: ["Ты подошёл ближе.", "You stepped closer."],
    take: ["Вещь у тебя в руках.", "The object is in your hands."],
    drop: ["Вещь лежит у ног.", "The object is at your feet."],
    open: ["Открыто.", "Opened."],
    close: ["Закрыто.", "Closed."],
    occupy: ["Ты устроился на месте.", "You settled into place."],
    leave: ["Ты снова на ногах.", "You are back on your feet."],
    wear: ["Ты переоделся.", "You put it on."],
    removeWear: ["Ты снял это.", "You took it off."],
    empty: ["Содержимое высыпалось рядом.", "The contents are now beside you."],
    detach: ["Крепление отпущено.", "The attachment is undone."],
    moveObject: ["Вещь сдвинулась.", "The object moved."],
    give: ["Вещь перешла в другие руки.", "The object changed hands."],
    put: ["Вещь внутри.", "The object is inside."],
    requestRole: [
      "Ты позвал окружающих поучаствовать.",
      "You asked the people around you to take part.",
    ],
  };
  return (
    lines[action.type]?.[locale === "en" ? 1 : 0] ??
    (locale === "en" ? "Done." : "Готово.")
  );
}

export function actionRefusalText(
  reason: string | null,
  locale: "ru" | "en",
): string {
  if (reason && /\p{Script=Cyrillic}/u.test(reason)) return reason;
  const lines: Record<string, [string, string]> = {
    "out of reach": [
      "Отсюда не дотянуться. Можно подойти ближе.",
      "It is out of reach. You can step closer.",
    ],
    "no path": ["Путь закрывает преграда.", "An obstacle blocks the way."],
    "different room": [
      "Эта вещь в другой комнате.",
      "That object is in another room.",
    ],
    "not held": ["Сначала нужно взять вещь в руки.", "Pick it up first."],
    "already held": ["Вещь уже у кого-то в руках.", "Someone is holding it."],
    "no space": [
      "Рядом недостаточно свободного места.",
      "There is not enough clear space nearby.",
    ],
    blocked: ["Здесь мешает другая вещь.", "Another object is in the way."],
    locked: ["Замок пока закрыт.", "The lock is still closed."],
    sealed: ["Створ пока запечатан.", "The threshold is still sealed."],
    "container is closed": ["Сначала открой крышку.", "Open the lid first."],
    "slot occupied": [
      "Это место уже занято.",
      "That place is already occupied.",
    ],
    occupied: ["Внутри уже кто-то есть.", "Someone is already inside."],
    "still worn": ["Сначала сними надетую вещь.", "Take it off first."],
    "no such object": [
      "Вещи здесь больше нет.",
      "The object is no longer here.",
    ],
    "already gone": ["Вещи здесь больше нет.", "The object is no longer here."],
    attached: [
      "Вещь держится на креплении. Его можно осмотреть.",
      "An attachment holds it in place. You can inspect it.",
    ],
  };
  return (
    lines[reason ?? ""]?.[locale === "en" ? 1 : 0] ??
    (locale === "en"
      ? "The situation changed before you finished."
      : "Пока ты действовал, положение вещей изменилось.")
  );
}
