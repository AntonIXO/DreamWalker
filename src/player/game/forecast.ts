/**
 * Suspicion, as weather.
 *
 * §3 forbids a meter. The sky is the readout: inverted, so the nicer the day the worse
 * you are doing. Four portrait rungs are not enough weather, so the cover is continuous —
 * how many people have looked up, and how badly, both here and elsewhere. The HUD names
 * the band. Passers-by at the frame are the people who noticed you and will not help.
 */

import { portraitRank, type PortraitState } from "../../shared/content";

export type SkyBand =
  | "night"
  | "overcast"
  | "drizzle"
  | "dry"
  | "clearing"
  | "clear"
  | "fine"
  | "yesterday";

interface SkyStop {
  at: number;
  id: SkyBand;
  weather: string | null;
}

/**
 * Named sky. Cover is 0..1; a band holds until the next stop. Night has no copy —
 * the sky is up, the HUD has not started talking.
 */
export const SKY_STOPS: readonly SkyStop[] = [
  { at: 0, id: "night", weather: null },
  { at: 0.1, id: "overcast", weather: "пасмурно" },
  { at: 0.24, id: "drizzle", weather: "морось" },
  { at: 0.38, id: "dry", weather: "без осадков" },
  { at: 0.52, id: "clearing", weather: "проясняется" },
  { at: 0.66, id: "clear", weather: "ясно" },
  { at: 0.8, id: "fine", weather: "хорошая погода" },
  { at: 0.92, id: "yesterday", weather: "как вчера" },
];

export interface CrowdMark {
  id: string;
  state: PortraitState;
}

export interface Forecast {
  /** Worst face in this room. Witnesses still key off faces, not the sky. */
  sky: PortraitState;
  /** 0..1, whole-dream weather. The shader lerps this. */
  cover: number;
  band: SkyBand;
  /** Copy, or null while the sky is still night. */
  weather: string | null;
  crowd: CrowdMark[];
}

export const EMPTY_FORECAST: Forecast = {
  sky: "neutral",
  cover: 0,
  band: "night",
  weather: null,
  crowd: [],
};

const CROWD_CAP = 8;
const SPREAD_FOR_FULL = 8;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function bandAt(cover: number): SkyStop {
  const t = clamp01(cover);
  let stop = SKY_STOPS[0]!;
  for (const candidate of SKY_STOPS) {
    if (candidate.at <= t) stop = candidate;
  }
  return stop;
}

export function coverForPortrait(state: PortraitState): number {
  const top = 3;
  const rank = portraitRank(state);
  return rank < 0 ? 0 : rank / top;
}

export function weatherFor(state: PortraitState): string | null {
  return bandAt(coverForPortrait(state)).weather;
}

export function skyCover(
  figures: readonly {
    readonly roomId: string;
    readonly portraitState: PortraitState;
  }[],
  roomId: string,
): number {
  let worst = 0;
  let local = 0;
  let noticed = 0;
  for (const figure of figures) {
    const rank = coverForPortrait(figure.portraitState);
    if (rank > worst) worst = rank;
    if (figure.roomId === roomId && rank > local) local = rank;
    if (rank > 0) noticed += 1;
  }
  const spread = clamp01(noticed / SPREAD_FOR_FULL);
  return clamp01(worst * 0.65 + local * 0.25 + spread * 0.2);
}

export function forecastFor(
  figures: readonly {
    readonly id: string;
    readonly roomId: string;
    readonly portraitState: PortraitState;
  }[],
  roomId: string,
): Forecast {
  let sky: PortraitState = "neutral";
  for (const figure of figures) {
    if (figure.roomId !== roomId) continue;
    if (portraitRank(figure.portraitState) > portraitRank(sky)) {
      sky = figure.portraitState;
    }
  }
  const cover = skyCover(figures, roomId);
  const stop = bandAt(cover);
  const crowd = figures
    .filter((figure) => portraitRank(figure.portraitState) > 0)
    .sort(
      (a, b) =>
        portraitRank(b.portraitState) - portraitRank(a.portraitState) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, CROWD_CAP)
    .map((figure) => ({ id: figure.id, state: figure.portraitState }));
  return {
    sky,
    cover,
    band: stop.id,
    weather: stop.weather,
    crowd,
  };
}
