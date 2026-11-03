// The demos the docs embed (../live.ts) against the catalogue: every entry
// draws a scene the gallery has, under a name a page can use, in a frame
// of a sensible height; the address a page frames and the look a frame
// reads back agree; and a frame takes only a well-formed theme message.
import { describe, expect, it } from "vitest";
import { SCENES } from "../catalog.ts";
import { DEFAULT_LIVE_THEME, LIVE, LIVE_BASE, LIVE_THEME_MESSAGE, isLiveThemeMessage, liveDemo, liveUrl, themeOf } from "../live.ts";
import { DRAWINGS } from "../scenes/index.ts";

describe("KIT-12 the docs show the kit's parts live, drawn by the same code the screenshot check approves", () => {
  it("each demo draws a scene the catalogue lists, so its drawing is the one the screenshot check approves", () => {
    const ids: readonly string[] = SCENES.map((scene) => scene.id);
    expect(LIVE.filter((demo) => !ids.includes(demo.scene)).map((demo) => demo.name)).toEqual([]);
  });

  it("each demo a reader can talk to has a scripted server behind it", () => {
    const silent = LIVE.filter((demo) => demo.interactive && DRAWINGS[demo.scene as keyof typeof DRAWINGS]().liveRoutes === undefined);
    expect(silent.map((demo) => demo.name)).toEqual([]);
  });

  it("have unique kebab-case names and frames between 200 and 800 pixels tall", () => {
    const names = LIVE.map((demo) => demo.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.filter((name) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))).toEqual([]);
    expect(LIVE.filter((demo) => !Number.isInteger(demo.height) || demo.height < 200 || demo.height > 800).map((demo) => demo.name)).toEqual([]);
  });

  it("refuse a name the list does not hold, naming the ones it does", () => {
    expect(() => liveDemo("chat-popover")).toThrow(/no live demo named "chat-popover".*"chat-popup"/);
  });
});

describe("a demo's look", () => {
  it("is framed at the gallery's docs path in the docs mode, and read back as it was asked", () => {
    const url = liveUrl("chat-popup", { preset: "friendly", mode: "light", radius: 0.75 });
    expect(url.startsWith(`${LIVE_BASE}?`)).toBe(true);
    const search = url.slice(url.indexOf("?"));
    expect(new URLSearchParams(search).get("embed")).toBe("1");
    expect(new URLSearchParams(search).get("scene")).toBe("agent-chat-popup");
    expect(themeOf(search)).toEqual({ preset: "friendly", mode: "light", radius: 0.75 });
  });

  it("leaves the default preset and the preset's own radius out of the address", () => {
    const search = liveUrl("chat-popup").slice(liveUrl("chat-popup").indexOf("?"));
    expect([...new URLSearchParams(search).keys()].sort()).toEqual(["embed", "mode", "scene"]);
    expect(themeOf(search)).toEqual(DEFAULT_LIVE_THEME);
  });

  it("reads an unknown preset, mode or radius as the default", () => {
    expect(themeOf("?preset=neon&mode=sepia&radius=9")).toEqual(DEFAULT_LIVE_THEME);
    expect(themeOf("?radius=-1")).toEqual(DEFAULT_LIVE_THEME);
  });

  it("changes only on a well-formed theme message", () => {
    const message = { type: LIVE_THEME_MESSAGE, preset: "fintech", mode: "dark", radius: null };
    expect(isLiveThemeMessage(message)).toBe(true);
    expect(isLiveThemeMessage({ ...message, radius: 0.5 })).toBe(true);
    expect(isLiveThemeMessage({ ...message, type: "other" })).toBe(false);
    expect(isLiveThemeMessage({ ...message, preset: "neon" })).toBe(false);
    expect(isLiveThemeMessage({ ...message, mode: "sepia" })).toBe(false);
    expect(isLiveThemeMessage({ ...message, radius: 3 })).toBe(false);
    expect(isLiveThemeMessage({ ...message, radius: "1" })).toBe(false);
    expect(isLiveThemeMessage(null)).toBe(false);
    expect(isLiveThemeMessage("stigmer-live-theme")).toBe(false);
  });
});
