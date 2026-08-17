import type { DreamScript } from "../../../src/shared/pack";
import { LOCK_STARTED_AT } from "../meta";

function upwardClock(now: number): string {
  const started = Date.parse(LOCK_STARTED_AT);
  const elapsed = Math.max(0, now - started);
  const days = Math.floor(elapsed / 86_400_000);
  const hours = Math.floor((elapsed % 86_400_000) / 3_600_000);
  return `${days} дн. ${String(hours).padStart(2, "0")} ч.`;
}

export const m11Script: DreamScript = {
  id: "m11-lock",
  roomId: "m11-zamok-po-vremeni",
  onEnter(host) {
    host.setFlag("sawTimeLock", true);
    host.whisper(`Закрыто. ${upwardClock(host.now())}`);
  },
};
