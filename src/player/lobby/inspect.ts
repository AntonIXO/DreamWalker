/**
 * Short diegetic readouts. Not a menu: the player already chose the object in the room.
 */

export interface InspectAction {
  label: string;
  kind?: "primary" | "ghost";
  onClick(): void;
}

export interface InspectSpec {
  title: string;
  category: string;
  body: string;
  actions?: readonly InspectAction[];
}

export interface InspectCallbacks {
  onClose(): void;
}

export class InspectPanel {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly categoryEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly actionsEl: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly callbacks: InspectCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel inspect";
    this.root.hidden = true;
    this.root.innerHTML = `
      <p class="inspect-category"></p>
      <h2></h2>
      <p class="inspect-body"></p>
      <div class="row inspect-actions"></div>
    `;
    parent.appendChild(this.root);
    this.titleEl = this.root.querySelector("h2")!;
    this.categoryEl = this.root.querySelector(".inspect-category")!;
    this.bodyEl = this.root.querySelector(".inspect-body")!;
    this.actionsEl = this.root.querySelector(".inspect-actions")!;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(spec: InspectSpec): void {
    this.titleEl.textContent = spec.title;
    this.categoryEl.textContent = spec.category;
    this.bodyEl.textContent = spec.body;
    this.actionsEl.replaceChildren();

    const actions = spec.actions ?? [];
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.kind === "ghost" ? "ghost" : "";
      button.textContent = action.label;
      button.addEventListener("click", () => action.onClick());
      this.actionsEl.appendChild(button);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ghost end";
    close.textContent = "Отойти";
    close.addEventListener("click", () => this.close());
    this.actionsEl.appendChild(close);

    this.root.hidden = false;
    (
      this.actionsEl.querySelector("button") as HTMLButtonElement | null
    )?.focus();
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.callbacks.onClose();
  }

  destroy(): void {
    this.root.remove();
  }
}
