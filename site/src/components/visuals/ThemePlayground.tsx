"use client";

/**
 * The theme playground on the theming page: the reader picks one of the six
 * presets, light or dark, and a corner radius, watches the chat change, and
 * copies the lines that give their product that look.
 *
 * The chat is the `chat-panel` live demo (test/visual/src/live.ts), framed
 * as `<Live>` frames it. Its first look comes from its address; after that
 * each change is posted to the frame as a theme message, from this page's
 * origin, so the chat switches in place and the reader keeps their place in
 * it. The code beside it comes from one writer (src/lib/theme-snippet.mjs),
 * which the docs' snippet check compiles for every preset.
 *
 * There is no colour picker: every preset passes the theme's contrast
 * audit, and a free colour would let a reader copy a pair that fails it.
 */
import { useEffect, useRef, useState } from "react";
import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { THEME_PRESETS } from "@stigmer/design-tokens";
import { cn } from "@/lib/utils";
import {
  LIVE_MODES,
  LIVE_THEME_MESSAGE,
  liveDemo,
  liveUrl,
  LIVE_CAPTION,
  type LivePreset,
  type LiveTheme,
  type LiveThemeMessage,
} from "@/lib/live";
import { themeSnippet } from "@/lib/theme-snippet.mjs";

/** The demo the playground dresses. */
const DEMO = "chat-panel";

/** The radius slider's range and step, in rem; the preset's own radius is the slider's "off". */
const RADIUS = { min: 0, max: 1.5, step: 0.125 } as const;

/** The look the playground opens on: the default look, in the site's dark mode. */
const FIRST: LiveTheme = { preset: "default", mode: "dark", radius: null };

export function ThemePlayground() {
  const [theme, setTheme] = useState<LiveTheme>(FIRST);
  const frame = useRef<HTMLIFrameElement>(null);
  // The frame's address is its first look only; changes after it are posted.
  const [src] = useState(() => liveUrl(DEMO, FIRST));
  const demo = liveDemo(DEMO);
  const snippet = themeSnippet(theme);

  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (!target) return;
    const message: LiveThemeMessage = { type: LIVE_THEME_MESSAGE, ...theme };
    target.postMessage(message, window.location.origin);
  }, [theme]);

  // A frame that loads after a change takes the current look as it loads.
  const onLoad = () => {
    const message: LiveThemeMessage = { type: LIVE_THEME_MESSAGE, ...theme };
    frame.current?.contentWindow?.postMessage(message, window.location.origin);
  };

  return (
    <figure className="not-prose my-6 rounded-lg border border-fd-border bg-fd-card">
      <div className="flex flex-col gap-4 border-b border-fd-border p-4">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Preset</legend>
          <div role="radiogroup" aria-label="Preset" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {THEME_PRESETS.map((preset) => {
              const checked = theme.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setTheme((current) => ({ ...current, preset: preset.id as LivePreset }))}
                  className={cn(
                    "flex items-start gap-2 rounded-md border p-2 text-left text-xs transition-colors",
                    checked ? "border-fd-foreground" : "border-fd-border hover:border-fd-muted-foreground",
                  )}
                >
                  <span aria-hidden className="mt-0.5 size-3 shrink-0 rounded-full" style={{ background: preset.swatch }} />
                  <span>
                    <span className="block font-medium">{preset.name}</span>
                    <span className="block text-fd-muted-foreground">{preset.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-6">
          <div role="radiogroup" aria-label="Colour mode" className="flex rounded-md border border-fd-border p-0.5 text-xs">
            {LIVE_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={theme.mode === mode}
                onClick={() => setTheme((current) => ({ ...current, mode }))}
                className={cn(
                  "rounded px-3 py-1 capitalize",
                  theme.mode === mode ? "bg-fd-foreground text-fd-background" : "text-fd-muted-foreground",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-3 text-xs">
            <span className="font-medium">Radius</span>
            <input
              type="range"
              min={RADIUS.min}
              max={RADIUS.max}
              step={RADIUS.step}
              value={theme.radius ?? 0.5}
              aria-valuetext={theme.radius === null ? "The preset's own" : `${theme.radius}rem`}
              onChange={(event) => setTheme((current) => ({ ...current, radius: Number(event.target.value) }))}
            />
            <span className="w-24 tabular-nums text-fd-muted-foreground">{theme.radius === null ? "the preset's own" : `${theme.radius}rem`}</span>
          </label>
          {theme.radius !== null && (
            <button
              type="button"
              onClick={() => setTheme((current) => ({ ...current, radius: null }))}
              className="text-xs text-fd-muted-foreground underline underline-offset-2"
            >
              Use the preset&rsquo;s radius
            </button>
          )}
        </div>
      </div>
      <iframe
        ref={frame}
        src={src}
        title={demo.title}
        aria-label="The chat panel in the look picked above"
        loading="lazy"
        onLoad={onLoad}
        className="block w-full border-b border-fd-border"
        style={{ height: demo.height }}
      />
      <div className="p-4">
        <DynamicCodeBlock lang="tsx" code={snippet.tsx} codeblock={{ title: "Themed.tsx" }} />
        {snippet.css !== null && <DynamicCodeBlock lang="css" code={snippet.css} codeblock={{ title: "my-theme.css" }} />}
      </div>
      <figcaption className="px-4 pb-4 text-xs text-fd-muted-foreground">{LIVE_CAPTION}</figcaption>
    </figure>
  );
}
