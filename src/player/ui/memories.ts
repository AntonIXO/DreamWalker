import { MindMemory } from "../mind/memory";

export interface MemoryPanelCallbacks {
  onReady(): void;
  onClose(wasOnboarding: boolean): void;
  onTimeBought(memoryText: string): void;
}

/** The three pieces of self a new sanitar brings into somebody else's head (§4). */
export class MemoryPanel {
  private readonly root: HTMLElement;
  private readonly inputs: HTMLTextAreaElement[];
  private readonly statusEl: HTMLElement;
  private readonly onboardingEl: HTMLElement;
  private readonly walletEl: HTMLElement;
  private readonly walletListEl: HTMLElement;
  private onboarding = false;

  constructor(
    parent: HTMLElement,
    private readonly memory: MindMemory,
    private readonly callbacks: MemoryPanelCallbacks,
  ) {
    this.root = document.createElement("div");
    this.root.className = "panel memories";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="memories-onboarding">
        <h2>Что ты принёс с собой</h2>
        <p>
          В чужой голове у тебя нет денег. Запиши три собственных воспоминания: ими
          можно подкупить фигуру или купить две минуты. Потраченное не возвращается.
        </p>
        ${[1, 2, 3]
          .map(
            (
              number,
            ) => `<label class="field"><span>Воспоминание ${number}</span>
              <textarea maxlength="240" rows="2"></textarea></label>`,
          )
          .join("")}
        <button class="memories-save" type="button">Войти с этим</button>
      </div>
      <div class="memories-wallet" hidden>
        <h2>Заплатить собой</h2>
        <p>Сожги одно воспоминание, чтобы удержать этот цикл ещё две минуты.</p>
        <div class="memories-wallet-list"></div>
      </div>
      <div class="connect-status"></div>
      <div class="row">
        <button class="memories-close ghost" type="button">Назад</button>
      </div>
    `;
    parent.appendChild(this.root);
    this.inputs = [
      ...this.root.querySelectorAll<HTMLTextAreaElement>("textarea"),
    ];
    this.statusEl = this.root.querySelector(".connect-status")!;
    this.onboardingEl = this.root.querySelector(".memories-onboarding")!;
    this.walletEl = this.root.querySelector(".memories-wallet")!;
    this.walletListEl = this.root.querySelector(".memories-wallet-list")!;
    this.root
      .querySelector(".memories-save")!
      .addEventListener("click", () => this.save());
    this.root
      .querySelector(".memories-close")!
      .addEventListener("click", () => this.close());
  }

  private save(): void {
    const values = this.inputs.map((input) => input.value.trim());
    if (values.some((value) => !value)) {
      this.statusEl.textContent = "Нужны все три воспоминания.";
      this.statusEl.className = "connect-status bad";
      return;
    }
    this.memory.setInitialMemories(values);
    this.root.hidden = true;
    this.callbacks.onReady();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.onboarding = !this.memory.hasInitialMemories;
    this.statusEl.textContent = "";
    this.onboardingEl.hidden = !this.onboarding;
    this.walletEl.hidden = this.onboarding;
    this.root.hidden = false;
    if (this.onboarding) this.inputs[0]?.focus();
    else this.renderWallet();
  }

  private renderWallet(): void {
    this.walletListEl.replaceChildren();
    const memories = this.memory.availableMemories();
    if (memories.length === 0) {
      const empty = document.createElement("p");
      empty.className = "dim";
      empty.textContent = "Ты уже отдал этому сну всё, что принёс.";
      this.walletListEl.appendChild(empty);
      return;
    }
    for (const memory of memories) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost memory-purchase";
      button.textContent = `${memory.text}  ·  +2:00`;
      button.addEventListener("click", () => {
        if (!this.memory.spendMemory(memory.id)) return;
        this.callbacks.onTimeBought(memory.text);
        this.statusEl.textContent = "Время отступило на две минуты.";
        this.statusEl.className = "connect-status ok";
        this.renderWallet();
      });
      this.walletListEl.appendChild(button);
    }
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.callbacks.onClose(this.onboarding);
  }
}
