import type { DreamScript } from "../../../src/shared/pack";

const LINE = ["server {", "  port: 25565", '  motd: "'] as const;

export const m10Script: DreamScript = {
  id: "m10-carrot",
  roomId: "m10-zamorozhennaia-morkovka",
  onEnter(host) {
    host.setFlag("m10.t", 0);
    host.setFlag("m10.typed", 0);
  },
  onUpdate(host, dt) {
    const t = Number(host.getFlag("m10.t") ?? 0) + dt;
    host.setFlag("m10.t", t);
    let typed = Number(host.getFlag("m10.typed") ?? 0);
    while (typed < LINE.length && t >= (typed + 1) * 4) {
      host.whisper(LINE[typed]!);
      typed += 1;
      host.setFlag("m10.typed", typed);
    }
  },
};
