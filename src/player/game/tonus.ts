/**
 * The sanitar's position on the dream's hidden chart.
 *
 * The maths is in `shared/tonus.ts`; this is the live coordinate and the rule about
 * where it is allowed to overflow. It belongs to the session rather than to
 * `ObservationLog`, because the log is the *sleeper's* view of the player and resets
 * every cycle, while this is the player's own mood and persists across them.
 *
 * Nothing here is ever shown as a number. §3's ban on a suspicion meter applies by
 * analogy: the player reads the chart as colour, glitch and how a room sounds, or not
 * at all. The readout exists only behind F1.
 */

import {
  advanceTonus,
  normaliseTonus,
  quadrantOf,
  scaleTonus,
  type Quadrant,
  type TonusDelta,
} from "../../shared/tonus";

export interface TonusStep {
  position: TonusDelta;
  /** True only on the beat the counter wrapped. The one moment worth a filter. */
  overflowed: boolean;
}

export class Tonus {
  private x = 0;
  private y = 0;
  /** The last delta applied, for М1 КОРНИ, whose whole trick is doubling it. */
  private last: TonusDelta = { x: 0, y: 0 };

  get position(): TonusDelta {
    return { x: this.x, y: this.y };
  }

  get quadrant(): Quadrant {
    return quadrantOf(this.position);
  }

  /** −1..1 per axis, for renderers that want a strength rather than a byte. */
  get normalised(): TonusDelta {
    return normaliseTonus(this.position);
  }

  get previousDelta(): TonusDelta {
    return { ...this.last };
  }

  /**
   * Move the marker.
   *
   * `allowOverflow` is the meta-space privilege, and it is the entire mechanic: an
   * ordinary room clamps, so the counter sits pinned at the floor storing pressure it
   * cannot spend. It only wraps somewhere nobody remembers being.
   */
  apply(delta: TonusDelta, allowOverflow: boolean): TonusStep {
    const result = advanceTonus(this.position, delta, allowOverflow);
    this.x = result.position.x;
    this.y = result.position.y;
    this.last = { ...delta };
    return { position: this.position, overflowed: result.overflowed };
  }

  /** М1: «(0, 0), но удваивает предыдущий сдвиг». */
  applyDoubled(allowOverflow: boolean): TonusStep {
    return this.apply(this.last, allowOverflow);
  }

  /** «Второй визит хуже первого» — the same room, multiplied by how often you came back. */
  applyScaled(
    delta: TonusDelta,
    factor: number,
    allowOverflow: boolean,
  ): TonusStep {
    return this.apply(scaleTonus(delta, factor), allowOverflow);
  }

  reset(): void {
    this.x = 0;
    this.y = 0;
    this.last = { x: 0, y: 0 };
  }
}
