import type { DreamScript } from "../../../src/shared/pack";

const STEP_TILES = 10;

export const m5Script: DreamScript = {
  id: "m5-walk-out",
  roomId: "m5-odinochestvo",
  onEnter(host) {
    host.setFlag("m5.x", host.playerX);
    host.setFlag("m5.y", host.playerY);
    host.setFlag("m5.steps", 0);
  },
  onUpdate(host) {
    const lastX = Number(host.getFlag("m5.x") ?? host.playerX);
    const lastY = Number(host.getFlag("m5.y") ?? host.playerY);
    const dx = host.playerX - lastX;
    const dy = host.playerY - lastY;
    host.setFlag("m5.x", host.playerX);
    host.setFlag("m5.y", host.playerY);
    const dist = Math.hypot(dx, dy) / host.tileSize;
    if (dist < 0.01) return;
    const steps = Number(host.getFlag("m5.steps") ?? 0) + dist;
    host.setFlag("m5.steps", steps);
    if (steps < STEP_TILES) return;
    const back = String(
      host.getFlag("returnTo") ?? "19-dvor-i-oranzhevye-lavochki",
    );
    host.enterRoom(back, "default", "meta-exit");
  },
};
