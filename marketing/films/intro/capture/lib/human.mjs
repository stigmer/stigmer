/**
 * Human-paced input for film captures. Playwright's defaults are
 * test-paced (teleporting cursor, instant typing); a film needs motion an
 * audience reads as a person: eased cursor glides, settle pauses, and
 * typing with natural rhythm. This is cinematography, not e2e — waits are
 * choreography, so fixed pauses are correct here, not flakiness.
 *
 * The Human also drives the on-camera cursor overlay (lib/cursor.mjs):
 * it is the one owner of pointer position, so the drawn cursor and the
 * synthetic mouse can never disagree — including inside iframes, where
 * DOM mouse events never reach the top frame (see cursor.mjs).
 */

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export class Human {
  /** @param {import("playwright").Page} page */
  constructor(page) {
    this.page = page;
    this.x = 960;
    this.y = 620;
  }

  /** Pause for choreography (seconds, film-friendly units). */
  async beat(seconds = 0.8) {
    await this.page.waitForTimeout(seconds * 1000);
  }

  /**
   * Update the drawn cursor. Failures are swallowed: at a navigation
   * boundary the overlay is being re-injected and one missed draw is
   * invisible on film, while an aborted take is not.
   */
  async draw(op, args = []) {
    await this.page
      .evaluate(([o, a]) => window.__stgmFilmCursor?.[o](...a), [op, args])
      .catch(() => {});
  }

  /** Glide the cursor to a locator's center (or an {x,y} point). */
  async moveTo(target, { durationMs = 650 } = {}) {
    const to =
      typeof target.boundingBox === "function"
        ? await target.boundingBox().then((b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))
        : target;
    const from = { x: this.x, y: this.y };
    const frames = Math.max(2, Math.round(durationMs / 16));
    for (let i = 1; i <= frames; i += 1) {
      const t = easeInOut(i / frames);
      const x = from.x + (to.x - from.x) * t;
      const y = from.y + (to.y - from.y) * t;
      await this.page.mouse.move(x, y);
      await this.draw("move", [x, y]);
      await this.page.waitForTimeout(16);
    }
    this.x = to.x;
    this.y = to.y;
  }

  /** Glide to a target, settle, click. */
  async click(target, opts = {}) {
    await this.moveTo(target, opts);
    await this.beat(0.25);
    await this.page.mouse.down();
    await this.draw("press");
    await this.page.waitForTimeout(90);
    await this.page.mouse.up();
    await this.draw("release");
  }

  /** Type into the focused element at a natural rhythm. */
  async type(text, { cps = 16 } = {}) {
    const base = 1000 / cps;
    for (const ch of text) {
      await this.page.keyboard.type(ch);
      await this.page.waitForTimeout(base * (0.7 + Math.random() * 0.6));
    }
  }

  /** Smooth wheel scroll by total pixels over a duration. */
  async scroll(totalPx, { durationMs = 1800 } = {}) {
    const stepPx = 16;
    const steps = Math.max(1, Math.round(Math.abs(totalPx) / stepPx));
    const dir = Math.sign(totalPx);
    for (let i = 0; i < steps; i += 1) {
      await this.page.mouse.wheel(0, dir * stepPx);
      await this.page.waitForTimeout(durationMs / steps);
    }
  }
}
