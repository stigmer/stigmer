"use client";

/**
 * The homepage hero's five moments: the five hard parts as tabs above one
 * picture of the product, each showing the worry it answers, the line that
 * says what its picture proves, and a real screen of it.
 *
 * The visitor sets the pace. The hero opens on the ask and moves to the next
 * moment after ten seconds, a line under the lit name filling as the time
 * runs, so a change never comes unannounced. Pointing at the hero or
 * focusing inside it holds the moment; choosing a moment stops the stepping
 * for good; the pause button stops it too. When the visitor asked for less
 * motion it never steps, and the tabs still work. The tabs follow the WAI-ARIA
 * pattern: one is selected, arrow keys move between them, and the panel is
 * labelled by the selected one.
 *
 * The pictures sit in one cell, all one size (the hero's test holds every
 * whole picture to the ask's size and every crop to its crop's). The ask is
 * beneath the others and always shows, so a moment not yet loaded shows the
 * ask rather than a hole: it is the page's largest paint, eager, first and
 * never faded. The others load after it; the chosen one fades in on top and
 * the one before it goes once it has. The words of all five sit in one cell
 * too, so the hero is as tall as its longest and nothing below it moves.
 *
 * The page is a static export, so the first render is the same whatever the
 * visitor's preference: the ask, not stepping. Stepping starts after the
 * page wakes, and only for a visitor who did not ask for less motion.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { AGENT_GET_IDS, type AgentGetId } from "@/lib/agent-gets";
import { shownScreen, shownSize } from "@/lib/screens";
import { LoopPause } from "./drawing/LoopPause";
import { ScreenPicture } from "./ScreenPicture";
import {
  ATTRIBUTE,
  HERO_BASE,
  HERO_CSS,
  HERO_MOMENTS,
  HERO_SCREENS,
  momentName,
  momentWorry,
  nextMoment,
  proofHref,
} from "./hero-moments";

/** The slot the whole pictures fill: the hero's container. */
const SIZES = "(width >= 80rem) 1216px, calc(100vw - 4rem)";

/** The panel the tabs show. */
const PANEL_ID = `${ATTRIBUTE}-panel`;

function tabId(id: AgentGetId): string {
  return `${ATTRIBUTE}-tab-${id}`;
}

/** Whether the visitor asked for less motion; false where the browser cannot say. */
function reducedMotion(): MediaQueryList | null {
  return typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
}

function HeroMoments({ className }: { className?: string }) {
  const [active, setActive] = React.useState<AgentGetId>(HERO_BASE);
  const [stepping, setStepping] = React.useState(false);
  const [paused, setPaused] = React.useState(false);
  const [pointing, setPointing] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const chosen = React.useRef(false);
  const tabs = React.useRef<Partial<Record<AgentGetId, HTMLButtonElement | null>>>({});

  // Stepping starts once the page wakes, unless the visitor asked for less
  // motion or has already chosen a moment; it follows the preference if it changes.
  React.useEffect(() => {
    const query = reducedMotion();
    const apply = () => setStepping(!chosen.current && !(query?.matches ?? false));
    apply();
    query?.addEventListener("change", apply);
    return () => query?.removeEventListener("change", apply);
  }, []);

  const choose = (id: AgentGetId, focus = false) => {
    chosen.current = true;
    setStepping(false);
    setActive(id);
    if (focus) tabs.current[id]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const at = AGENT_GET_IDS.indexOf(active);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: AGENT_GET_IDS.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    choose(AGENT_GET_IDS[(to + AGENT_GET_IDS.length) % AGENT_GET_IDS.length], true);
  };

  const crop = shownSize(shownScreen(HERO_SCREENS[HERO_BASE].narrow));
  const style = { "--crop-width": `${crop.width}px` } as React.CSSProperties;
  const held = paused || pointing || focused;

  return (
    <div
      {...{ [`data-${ATTRIBUTE}`]: "" }}
      data-held={held}
      onPointerEnter={() => setPointing(true)}
      onPointerLeave={() => setPointing(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      className={cn("flex flex-col gap-5", className)}
    >
      <style href={ATTRIBUTE} precedence="default">
        {HERO_CSS}
      </style>

      <div
        role="tablist"
        aria-label="The five hard parts"
        onKeyDown={onKeyDown}
        className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm"
      >
        {AGENT_GET_IDS.map((id) => {
          const selected = id === active;
          return (
            <button
              key={id}
              ref={(element) => {
                tabs.current[id] = element;
              }}
              type="button"
              role="tab"
              id={tabId(id)}
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => choose(id)}
              className={cn(
                "relative whitespace-nowrap pb-1.5 transition-colors hover:text-foreground",
                selected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {momentName(id)}
              {selected && (
                <span aria-hidden="true" className="absolute bottom-0 left-0 h-px w-full bg-border">
                  {stepping ? (
                    <span
                      key={active}
                      {...{ [`data-${ATTRIBUTE}-progress`]: "" }}
                      onAnimationEnd={() => setActive(nextMoment(active))}
                      className="absolute inset-0 bg-foreground"
                    />
                  ) : (
                    <span className="absolute inset-0 bg-foreground" />
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(active)} className="flex flex-col gap-5">
        <div className="grid text-center">
          {AGENT_GET_IDS.map((id) => (
            <div
              key={id}
              data-moment-words={id}
              aria-hidden={id === active ? undefined : true}
              inert={id !== active}
              className={cn("col-start-1 row-start-1 flex flex-col items-center gap-1", id !== active && "invisible")}
            >
              <p className="m-0 text-sm text-muted-foreground">{momentWorry(id)}</p>
              <p className="m-0 max-w-2xl text-base text-foreground">
                {HERO_MOMENTS[id].answer}{" "}
                <a href={proofHref(id)} className="whitespace-nowrap text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
                  See the proof
                </a>
              </p>
            </div>
          ))}
        </div>

        <div className="relative mx-auto w-full pb-10 max-lg:max-w-(--crop-width)" style={style}>
          <div className="grid">
            {AGENT_GET_IDS.map((id) => {
              const base = id === HERO_BASE;
              const shown = id === active;
              return (
                <div
                  key={id}
                  {...(base ? {} : { [`data-${ATTRIBUTE}-picture`]: "" })}
                  data-moment={id}
                  aria-hidden={shown ? undefined : true}
                  className={cn(
                    "col-start-1 row-start-1",
                    base ? "z-0" : shown ? "z-20 opacity-100" : "z-10 opacity-0 delay-[600ms]",
                  )}
                >
                  <ScreenPicture
                    name={HERO_SCREENS[id].whole}
                    narrow={HERO_SCREENS[id].narrow}
                    alt={HERO_MOMENTS[id].alt}
                    sizes={SIZES}
                    priority={base}
                  />
                </div>
              );
            })}
          </div>
          {stepping && <LoopPause prefix={ATTRIBUTE} paused={paused} onToggle={() => setPaused((was) => !was)} />}
        </div>
      </div>
    </div>
  );
}

export { HeroMoments };
