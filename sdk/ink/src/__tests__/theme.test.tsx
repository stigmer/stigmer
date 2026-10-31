// Pins the terminal kit's colours (INK-15): by default only status roles
// carry a hue (the accent is bold foreground, muted is dim), a host's
// partial theme overrides roles through the provider, and no component names
// a hue of its own: every colour goes through a role.
import React from "react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Text } from "ink";
import { render } from "ink-testing-library";
import type { Stigmer } from "@stigmer/client";
import { InkStigmerProvider } from "../provider.js";
import { DEFAULT_INK_THEME, resolveInkTheme, roleStyle, useInkTheme, useRoles, useTerminalBackground } from "../theme.js";
import type { TerminalBackground } from "../terminal-background.js";

const SRC = new URL("..", import.meta.url).pathname;
/** A colour written as a literal: a `color`/`borderColor` prop or a `color:` field naming a hue or a hex value. */
const HUE = /(?:color|borderColor)=(?:"[^"]*"|\{[^}]*["'][a-z#][^"']*["'][^}]*\})|color: "[^"]*"/g;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && entry.name !== "theme.ts" ? [path] : [];
  });
}

function BackgroundProbe() {
  return <Text>{useTerminalBackground()}</Text>;
}

function Probe() {
  const theme = useInkTheme();
  const role = useRoles();
  return <Text>{JSON.stringify({ accent: theme.accent ?? null, danger: theme.danger, accentStyle: role.accent })}</Text>;
}

describe("INK-15 a host passes its own colours; by default only status colours carry a hue", () => {
  it("the default gives a hue to success, warning and danger alone", () => {
    expect(roleStyle(DEFAULT_INK_THEME, "accent")).toEqual({ bold: true });
    expect(roleStyle(DEFAULT_INK_THEME, "muted")).toEqual({ dimColor: true });
    expect(["success", "warning", "danger"].map((role) => roleStyle(DEFAULT_INK_THEME, role as "success").color)).toEqual(["green", "yellow", "red"]);
  });

  it("a host's partial theme replaces the roles it names, through the provider", () => {
    const client = { baseUrl: "http://localhost:7234" } as unknown as Stigmer;
    const { lastFrame } = render(
      <InkStigmerProvider client={client} theme={{ accent: "magenta", danger: "#ff5555" }}>
        <Probe />
      </InkStigmerProvider>,
    );
    expect(JSON.parse(lastFrame() ?? "{}")).toEqual({ accent: "magenta", danger: "#ff5555", accentStyle: { color: "magenta", bold: true } });
    expect(resolveInkTheme({ muted: "gray" })).toEqual({ ...DEFAULT_INK_THEME, muted: "gray" });
    expect(roleStyle(resolveInkTheme({ muted: "gray" }), "muted")).toEqual({ color: "gray" });
  });

  it("a host's theme as a function of the background follows the background the provider was given", () => {
    const client = { baseUrl: "http://localhost:7234" } as unknown as Stigmer;
    const theme = (background: TerminalBackground) => ({ accent: background === "light" ? "#5b21b6" : "#c4b5fd" });
    const drawn = (background: TerminalBackground) =>
      JSON.parse(
        render(
          <InkStigmerProvider client={client} theme={theme} background={background}>
            <Probe />
          </InkStigmerProvider>,
        ).lastFrame() ?? "{}",
      ).accent;
    expect([drawn("light"), drawn("dark")]).toEqual(["#5b21b6", "#c4b5fd"]);
    expect(resolveInkTheme(theme)).toEqual({ ...DEFAULT_INK_THEME, accent: "#c4b5fd" });
    const { lastFrame } = render(
      <InkStigmerProvider client={client} background="light">
        <BackgroundProbe />
      </InkStigmerProvider>,
    );
    expect(lastFrame()).toBe("light");
    expect(render(<BackgroundProbe />).lastFrame()).toBe("unknown");
  });

  it("outside a provider the default holds", () => {
    expect(JSON.parse(render(<Probe />).lastFrame() ?? "{}").accent).toBeNull();
  });

  it("no component names a hue: every colour goes through a role", () => {
    const named = sources(SRC).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(HUE)].map((match) => `${file.slice(SRC.length)}: ${match[0]}`),
    );
    expect(named).toEqual([]);
  });
});
