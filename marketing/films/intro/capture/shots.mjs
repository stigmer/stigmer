/**
 * The shot registry — the approved shot list (stigmer-cloud project
 * 20260902.01, script v1) as executable capture drives. One entry per
 * shot id; `node capture.mjs <id...>` records them.
 *
 * Notes against the shot list:
 * - s4-chat is ONE continuous take covering S4a (chat + tool calls),
 *   S4b (the approval hero shot), and S4c (approve → resume → done);
 *   the composition cuts it into beats. S2e reuses S4b's frames.
 * - S3e (terminal) is not a browser capture — see transcript.mjs.
 * - S4d (embed) records against Stigmer Cloud (owner decision at the
 *   demo-content gate) — see s4d below for its preconditions.
 * - The chat scene is the owner-approved two-turn beat: natural ask,
 *   agent proposes, a quick "yes", then the gate.
 */
import { CONSOLE_ORIGIN, ORG, dismissBanner, ensureOrg } from "./lib/harness.mjs";

const lib = (path) => `${CONSOLE_ORIGIN}/library/${path}`;

export const SHOTS = {
  /**
   * S3b (console alternative) — the agent overview, scrolled top to
   * bottom in narration order: instructions → skills → MCP servers →
   * sub-agents. The console has no YAML surface for agents, so the
   * script's "YAML in editor" drift is proposed as a styled Remotion
   * code panel over the real manifest (the S3e terminal treatment);
   * this take is the real-console alternative for the footage gate.
   */
  "s3b-agent-overview": async (page, human) => {
    await ensureOrg(page, human);
    await page.goto(lib(`agents/${ORG}/traveler-assist`), { waitUntil: "networkidle" });
    await human.beat(2.5);
    await human.scroll(650, { durationMs: 7000 });
    await human.beat(7);
  },

  /** S3c — the rebooking-policy skill with its stable version tag. */
  "s3c-skill": async (page, human) => {
    await ensureOrg(page, human);
    await page.goto(lib(`skills/${ORG}/rebooking-policy`), { waitUntil: "networkidle" });
    await human.beat(2.5);
    await human.scroll(400, { durationMs: 3000 });
    await human.beat(9);
  },

  /**
   * S3d — meridian-ops capabilities, settling on the approval policies
   * tab (the narration beat: "notice the approval policy"). The tools
   * list plays first, then the camera's story is the Policies tab.
   */
  "s3d-mcp-config": async (page, human) => {
    await ensureOrg(page, human);
    await page.goto(lib(`mcp-servers/${ORG}/meridian-ops`), { waitUntil: "networkidle" });
    await human.beat(2);
    await human.scroll(420, { durationMs: 3000 });
    await human.beat(1.5);
    await human.click(page.getByRole("tab", { name: /policies/i }).or(page.getByText(/^Policies/)).first());
    await human.beat(11);
  },

  /** S3f — the live agent card in the library. */
  "s3f-agent-card": async (page, human) => {
    await ensureOrg(page, human);
    await page.goto(lib("agents"), { waitUntil: "networkidle" });
    await human.beat(1.5);
    await human.moveTo(page.getByText("traveler-assist").first(), { durationMs: 900 });
    await human.beat(6);
  },

  /** S4a–c — the full chat take: ask → proposal → yes → gate → approve → done. */
  "s4-chat": async (page, human) => {
    await ensureOrg(page, human);
    await page.goto(`${CONSOLE_ORIGIN}/`, { waitUntil: "networkidle" });
    await human.beat(1);

    // Pick the agent on the home composer (configure → Agent → search),
    // then ask.
    await human.click(page.getByRole("button", { name: "Configure agent, tools, and skills" }));
    await human.click(page.getByRole("menuitem", { name: "Agent", exact: true }));
    await human.type("traveler");
    await human.beat(0.8);
    await human.click(page.getByRole("option", { name: /traveler-assist/i }).first());
    await human.beat(0.5);
    await human.click(page.getByRole("textbox").first());
    await human.type("Hi! I'm on booking MT-4821 — can you move my flight to tomorrow morning? Tomorrow is Sep 11.");
    await human.beat(0.5);
    await page.keyboard.press("Enter");

    // The agent reads the policy, resolves the booking, searches, and
    // proposes MT-102 — its proposal always quotes the $42 fare
    // difference (deterministic fixtures), so that text is the settle
    // signal the audience also sees.
    await page.getByText(/\$42/).first().waitFor({ timeout: 180_000 });
    await human.beat(3);

    // The quick confirmation turn.
    await human.click(page.getByRole("textbox").first());
    await human.type("Yes, go ahead.");
    await human.beat(0.4);
    await page.keyboard.press("Enter");

    // The hero beat: the run pauses and asks.
    await page.getByRole("button", { name: "Approve", exact: true }).waitFor({ timeout: 180_000 });
    await human.beat(4);
    await human.click(page.getByRole("button", { name: "Approve", exact: true }));

    // Resume → the confirmation code renders in the summary.
    await page.getByText(/RBK-4821/).first().waitFor({ timeout: 180_000 });
    await human.beat(5);
  },

  /** S4e — the hosted share link, live for anyone you choose. */
  "s4e-share": async (page, human) => {
    await page.goto(`${CONSOLE_ORIGIN}/chat/${ORG}/traveler-assist`, { waitUntil: "networkidle" });
    await dismissBanner(page);
    await human.beat(2);
    await human.click(page.getByRole("textbox").first());
    await human.type("Can I change my flight if I'm on a Saver fare?");
    await human.beat(0.5);
    await page.keyboard.press("Enter");
    await human.beat(20); // answer streams (policy question, no tools)
  },

  /** S5a — the disruption-digest pipeline on the canvas. */
  "s5a-workflow": async (page, human) => {
    await ensureOrg(page, human);
    await page.goto(lib(`workflows/${ORG}/disruption-digest`), { waitUntil: "networkidle" });
    await human.beat(14);
  },

  /**
   * S5b — the budget: a hard limit on what a run may spend. The scroll
   * brings the budget block toward frame center (rough-cut gate note:
   * the first take left it pinned to the bottom edge).
   */
  "s5b-budget": async (page, human) => {
    await ensureOrg(page, human);
    await page.goto(lib(`workflows/${ORG}/disruption-digest`), { waitUntil: "networkidle" });
    await human.beat(1.5);
    const budget = page.getByText(/budget/i).first();
    await human.click(budget);
    await human.beat(1);
    await human.scroll(380, { durationMs: 2600 });
    await human.beat(9);
  },

  /** S5c — the daily schedule. */
  "s5c-schedule": async (page, human) => {
    await ensureOrg(page, human);
    await page.goto(lib(`schedules/${ORG}/daily-disruption-digest`), { waitUntil: "networkidle" });
    await human.beat(10);
  },

  /**
   * S4d — the payoff beat: Meridian's own React app with the assistant
   * integrated through @stigmer/react (owner ruling at the v2 gate:
   * the React component, not the iframe widget — richer UX and the whole
   * film stays local). A before/after story: the page with NO assistant,
   * then the panel appears (the composition cuts the JSX snippet graphic
   * between the two), then a real traveler question answered on camera
   * against the live local stack.
   *
   * Precondition: the Meridian app is serving — `npm run demo:app`
   * (http://localhost:4173). Run with: node capture.mjs s4d-embed
   */
  "s4d-embed": async (page, human) => {
    const url = process.env.S4D_PAGE_URL ?? "http://localhost:4173";
    // The "before": hold the assistant's slot empty from the first paint
    // so the take opens on their product as it is without Stigmer. The
    // panel still mounts behind the curtain, so the reveal is a finished
    // surface, not a loading state.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.id = "stgm-hold-widget";
        style.textContent = "aside { visibility: hidden !important; }";
        document.head.appendChild(style);
      });
    });
    await page.goto(url, { waitUntil: "networkidle" });

    // A visitor reading the page: drift over the booking content.
    await human.beat(1.5);
    await human.moveTo({ x: 640, y: 520 }, { durationMs: 1400 });
    await human.beat(3);

    // The "after": the component is in — the assistant is live.
    await page.evaluate(() => document.getElementById("stgm-hold-widget")?.remove());
    await human.beat(3.5);

    // A real traveler question, answered by the real agent on the live
    // local stack (policy question — streams an answer, no tool calls).
    const input = page.locator("#assistant-panel").getByRole("textbox").first();
    await input.waitFor({ timeout: 60_000 });
    await human.click(input);
    await human.type("Do I have to pay a fee to change my flight?");
    await human.beat(0.5);
    await page.keyboard.press("Enter");
    await human.beat(22); // the answer streams
  },
};
