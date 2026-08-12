/**
 * Keyboard.
 *
 * Held keys drive movement and are read every frame; pressed keys are one-shot actions
 * and are drained by whoever handles them. Keeping the two apart stops a single tap of
 * `e` from opening a dialogue eight times while the frame rate is high.
 *
 * The one subtle rule here is about `preventDefault`. Bindings are by `event.code`, which
 * is a *physical* key and says nothing about the character it produces: `KeyD` is `в` on a
 * Russian layout. So cancelling a bound key while the player is typing does not merely
 * suppress a shortcut, it eats a letter — and §3 makes the wording of a question the whole
 * game. Nothing may be cancelled unless this class is actually going to act on it.
 */

export const Action = {
  UP: "up",
  DOWN: "down",
  LEFT: "left",
  RIGHT: "right",
  INTERACT: "interact",
  DEBUG: "debug",
  HELP: "help",
  MEMORIES: "memories",
  JOURNAL: "journal",
  WORDS: "words",
  HEARTBEAT: "heartbeat",
  GRANT: "grant",
  CANCEL: "cancel",
} as const;

export type ActionName = (typeof Action)[keyof typeof Action];

const BINDINGS: Record<string, ActionName> = {
  KeyW: Action.UP,
  ArrowUp: Action.UP,
  KeyS: Action.DOWN,
  ArrowDown: Action.DOWN,
  KeyA: Action.LEFT,
  ArrowLeft: Action.LEFT,
  KeyD: Action.RIGHT,
  ArrowRight: Action.RIGHT,
  KeyE: Action.INTERACT,
  Space: Action.INTERACT,
  F1: Action.DEBUG,
  KeyH: Action.HELP,
  KeyM: Action.MEMORIES,
  KeyJ: Action.JOURNAL,
  KeyN: Action.WORDS,
  // Not `H`: that is the help overlay now, and a key that both opens a panel and wakes
  // the sleeper would make every glance at the controls change the world.
  KeyB: Action.HEARTBEAT,
  KeyK: Action.GRANT,
  Escape: Action.CANCEL,
};

/** Actions that still reach the game while a panel holds the keyboard. */
const ALWAYS_LISTENING: ReadonlySet<ActionName> = new Set([Action.CANCEL]);

/** How a key code reads to a person. Only the ones whose `code` is not already the label. */
const KEY_LABELS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Space: "Пробел",
};

function label(code: string): string {
  return KEY_LABELS[code] ?? code.replace(/^Key/, "");
}

/**
 * Every key bound to an action, for display. The controls panel reads this rather than
 * keeping its own list, so a rebinding here cannot leave the panel telling the player
 * something that stopped being true.
 */
export function keyFor(action: ActionName): string {
  return Object.entries(BINDINGS)
    .filter(([, bound]) => bound === action)
    .map(([code]) => label(code))
    .join(" · ");
}

/**
 * Whether the keystroke is going into something the player is writing in. Checked as well
 * as `captured` because focus can land in a field the game did not open — the connection
 * panel, or a browser autofill box — and neither of them should have to announce itself.
 */
function isTextEntry(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable
  );
}

export class Input {
  private readonly held = new Set<ActionName>();
  private readonly pressed = new Set<ActionName>();
  /** While a dialogue has the keyboard, movement keys must not leak through. */
  private captured = false;

  /** True when the keystroke belongs to whatever the player is typing into, not to us. */
  private deaf(event: KeyboardEvent, action: ActionName): boolean {
    if (ALWAYS_LISTENING.has(action)) return false;
    return this.captured || isTextEntry(event.target);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const action = BINDINGS[event.code];
    if (!action) return;
    if (this.deaf(event, action)) return;
    // Only now, having decided to act on it: F1 opens browser help and Space scrolls the
    // page, and neither is wanted while walking.
    event.preventDefault();
    if (!this.held.has(action)) this.pressed.add(action);
    this.held.add(action);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const action = BINDINGS[event.code];
    if (!action) return;
    // Released keys are always forgotten, even ones that arrived while deaf: a key held
    // down before a panel opened would otherwise stay held for ever.
    this.held.delete(action);
  };

  /** Losing focus mid-stride would otherwise leave the player walking into a wall. */
  private readonly onBlur = (): void => {
    this.held.clear();
    this.pressed.clear();
  };

  attach(target: Window = window): void {
    target.addEventListener("keydown", this.onKeyDown);
    target.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("blur", this.onBlur);
  }

  detach(target: Window = window): void {
    target.removeEventListener("keydown", this.onKeyDown);
    target.removeEventListener("keyup", this.onKeyUp);
    target.removeEventListener("blur", this.onBlur);
  }

  setCaptured(captured: boolean): void {
    this.captured = captured;
    if (captured) this.held.clear();
  }

  isHeld(action: ActionName): boolean {
    return this.held.has(action);
  }

  /** True once per physical press. */
  consume(action: ActionName): boolean {
    if (!this.pressed.has(action)) return false;
    this.pressed.delete(action);
    return true;
  }

  /** Movement as a unit-ish vector. Diagonals are normalised so they are not faster. */
  axis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.isHeld(Action.LEFT)) x -= 1;
    if (this.isHeld(Action.RIGHT)) x += 1;
    if (this.isHeld(Action.UP)) y -= 1;
    if (this.isHeld(Action.DOWN)) y += 1;
    if (x !== 0 && y !== 0) {
      const inv = Math.SQRT1_2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  endFrame(): void {
    this.pressed.clear();
  }
}
