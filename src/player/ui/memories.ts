import { MindMemory } from "../mind/memory";
import { t } from "../../shared/i18n";

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
  private readonly onboardingTitleEl: HTMLElement;
  private readonly onboardingBodyEl: HTMLElement;
  private readonly fieldLabels: HTMLElement[];
  private readonly saveBtn: HTMLButtonElement;
  private readonly walletEl: HTMLElement;
  private readonly walletTitleEl: HTMLElement;
  private readonly walletBodyEl: HTMLElement;
  private readonly walletListEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
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
        <h2 class="memories-onboarding-title"></h2>
        <p class="memories-onboarding-body"></p>
        ${[1, 2, 3]
          .map(
            (
              number,
            ) => `<label class="field"><span class="memories-slot-label-${number}"></span>
              <textarea maxlength="240" rows="2"></textarea></label>`,
          )
          .join("")}
        <button class="memories-save" type="button"></button>
      </div>
      <div class="memories-wallet" hidden>
        <h2 class="memories-wallet-title"></h2>
        <p class="memories-wallet-body"></p>
        <div class="memories-wallet-list"></div>
      </div>
      <div class="connect-status"></div>
      <div class="row">
        <button class="memories-close ghost" type="button"></button>
      </div>
    `;
    parent.appendChild(this.root);
    this.inputs = [
      ...this.root.querySelectorAll<HTMLTextAreaElement>("textarea"),
    ];
    this.statusEl = this.root.querySelector(".connect-status")!;
    this.onboardingEl = this.root.querySelector(".memories-onboarding")!;
    this.onboardingTitleEl = this.root.querySelector(
      ".memories-onboarding-title",
    )!;
    this.onboardingBodyEl = this.root.querySelector(
      ".memories-onboarding-body",
    )!;
    this.fieldLabels = [1, 2, 3].map((n) =>
      this.root.querySelector(`.memories-slot-label-${n}`)!,
    );
    this.saveBtn = this.root.querySelector(".memories-save")!;
    this.walletEl = this.root.querySelector(".memories-wallet")!;
    this.walletTitleEl = this.root.querySelector(".memories-wallet-title")!;
    this.walletBodyEl = this.root.querySelector(".memories-wallet-body")!;
    this.walletListEl = this.root.querySelector(".memories-wallet-list")!;
    this.closeBtn = this.root.querySelector(".memories-close")!;

    this.saveBtn.addEventListener("click", () => this.save());
    this.closeBtn.addEventListener("click", () => this.close());
  }

  private save(): void {
    const values = this.inputs.map((input) => input.value.trim());
    if (values.some((value) => !value)) {
      this.statusEl.textContent = t("memories.need_three");
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

    this.onboardingTitleEl.textContent = t("memories.onboarding_title");
    this.onboardingBodyEl.textContent = t("memories.onboarding_body");
    this.fieldLabels.forEach((label, idx) => {
      label.textContent = t("memories.slot_label", { n: idx + 1 });
    });
    this.saveBtn.textContent = t("memories.take_with");
    this.walletTitleEl.textContent = t("memories.wallet_title");
    this.walletBodyEl.textContent = t("memories.wallet_body");
    this.closeBtn.textContent = t("ui.back");

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
      empty.textContent = t("memories.all_spent");
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
        this.statusEl.textContent = t("ui.whisper_time_added");
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
