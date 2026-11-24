/**
 * Runs the demo story day by day (oldest first), each event on the device of the person who
 * would have made it, stamped with that day's clock. Sync order keeps the books consistent:
 *   staff devices push first → the owner pulls them → day closes (expected cash is then right)
 *   → the owner pushes last, so a DAY_CLOSE never reaches the server before the entries it covers.
 */
import { setClockForTests } from "@/client/clock";
import { at, day, evening } from "./helpers";
import type { DemoDevice } from "./harness";

export interface Ev {
  back: number;
  who: DemoDevice;
  label: string;
  run: () => Promise<void>;
  /** Evening day-close events run after everything else of the day. */
  closing?: boolean;
}

export class Timeline {
  readonly events: Ev[] = [];

  add(back: number, who: DemoDevice, label: string, run: () => Promise<void>): void {
    this.events.push({ back, who, label, run });
  }

  close(back: number, who: DemoDevice, label: string, run: () => Promise<void>): void {
    this.events.push({ back, who, label, run, closing: true });
  }
}

export async function runTimeline(
  tl: Timeline,
  owner: DemoDevice,
  beforeDay: (date: string) => Promise<void>,
  log: (s: string) => void,
): Promise<void> {
  const maxBack = Math.max(...tl.events.map((e) => e.back));
  for (let back = maxBack; back >= 0; back--) {
    const today = tl.events.filter((e) => e.back === back);
    if (today.length === 0) continue;
    const date = day(back);
    const normal = today.filter((e) => !e.closing);
    const closing = today.filter((e) => e.closing);
    const writers = new Set<DemoDevice>([owner]);
    const fresh = new Set<DemoDevice>([owner]);

    const exec = async (ev: Ev, evening_: boolean) => {
      if (!fresh.has(ev.who)) {
        await ev.who.sync();
        fresh.add(ev.who);
      }
      ev.who.use();
      if (evening_) evening(date);
      else at(date);
      try {
        await ev.run();
      } catch (e) {
        const msg =
          e instanceof Error
            ? `${e.message}${(e as { detail?: string }).detail ? ` (${(e as { detail?: string }).detail})` : ""}`
            : String(e);
        throw new Error(`[${date}] ${ev.label}: ${msg}`);
      }
      writers.add(ev.who);
    };

    owner.use();
    at(date);
    await beforeDay(date);
    for (const ev of normal) await exec(ev, false);

    const staff = [...writers].filter((w) => w !== owner);
    for (const w of staff) await w.sync();
    await owner.sync();
    if (closing.length > 0) {
      for (const ev of closing) await exec(ev, true);
      await owner.sync();
    }
    log(`  ${date}  ${today.length} event(s)`);
  }
  setClockForTests(null);
}
