"use client";

/**
 * The homepage hero's five moments: the five hard parts named above one
 * picture of the product, which steps through a real screen for each.
 *
 * The names are always on screen, in the five's order, each a link to its
 * row in the section below; the name of the moment on screen is lit and its
 * caption shows under them. The pictures sit in one cell, all one size (the
 * hero's test holds every whole picture to the ask's size and every crop to
 * its crop's), so one covers another exactly. The ask is beneath the others, held there by
 * its stacking order rather than its place in the markup, so a screen
 * reader meets the five pictures' descriptions in the five's order. The
 * ask is the page's largest paint: eager, first, and never animated. The
 * other four load after it and fade in over it at their steps, so one that
 * has not loaded yet shows the ask rather than a hole.
 *
 * The walk is the site's loop engine (`drawing/loop.ts`, the data in
 * ./hero-moments.ts): CSS keyframes on opacity alone, so the markup never
 * changes on its own and reads the same whatever the visitor's motion
 * preference; the site's reduced-motion block lands it on the ask, still,
 * and hides the pause button. The paused state is the one piece of state.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { AGENT_GET_IDS } from "@/lib/agent-gets";
import { shownScreen, shownSize } from "@/lib/screens";
import { LoopPause } from "./drawing/LoopPause";
import { ScreenPicture } from "./ScreenPicture";
import { ATTRIBUTE, HERO_BASE, HERO_LINK, HERO_MOMENTS, HERO_SCREENS, LOOP_CSS, momentName, proofHref } from "./hero-moments";

/** The slot the whole pictures fill: the hero's container. */
const SIZES = "(width >= 80rem) 1216px, calc(100vw - 4rem)";

/** The five names, the lit one over its resting look, and the lit moment's caption under them. */
function Names() {
  return (
    <nav aria-label="The five hard parts" className="flex flex-col items-center gap-2.5">
      <ul className="m-0 flex list-none flex-wrap justify-center gap-x-5 gap-y-1.5 p-0 text-sm">
        {AGENT_GET_IDS.map((id) => (
          <li key={id}>
            {/* The lit copy keeps the resting text's weight and line, so it covers it exactly. */}
            <a
              href={proofHref(id)}
              className="relative inline-block whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
            >
              {momentName(id)}
              <span
                aria-hidden="true"
                data-part={id}
                className="absolute inset-0 whitespace-nowrap text-foreground underline underline-offset-[6px]"
              >
                {momentName(id)}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <div aria-hidden="true" className="grid text-center text-sm text-muted-foreground">
        {AGENT_GET_IDS.map((id) => (
          <p key={id} data-part={id} className="col-start-1 row-start-1 m-0">
            {HERO_MOMENTS[id].caption}
          </p>
        ))}
      </div>
    </nav>
  );
}

function HeroMoments({ className }: { className?: string }) {
  const [paused, setPaused] = React.useState(false);
  const crop = shownSize(shownScreen(HERO_SCREENS[HERO_BASE].narrow));
  const style = { "--crop-width": `${crop.width}px` } as React.CSSProperties;

  return (
    <div {...{ [`data-${ATTRIBUTE}`]: "" }} data-paused={paused} className={cn("flex flex-col gap-5", className)}>
      <style href={ATTRIBUTE} precedence="default">
        {LOOP_CSS}
      </style>
      <Names />
      <div className="relative mx-auto w-full pb-10 max-lg:max-w-(--crop-width)" style={style}>
        <div className="grid">
          {AGENT_GET_IDS.map((id) => {
            const base = id === HERO_BASE;
            return (
              <div
                key={id}
                {...(base ? {} : { "data-part": id })}
                className={cn("col-start-1 row-start-1", base ? "z-0" : "z-10")}
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
        <a
          href={HERO_LINK.href}
          className="absolute bottom-1 left-0 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          {HERO_LINK.text}
        </a>
        <LoopPause prefix={ATTRIBUTE} paused={paused} onToggle={() => setPaused((was) => !was)} />
      </div>
    </div>
  );
}

export { HeroMoments };
