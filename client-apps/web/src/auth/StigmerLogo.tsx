/** Keep public-page branding in the console shell, using the canonical refined mark. */
"use client";

import { useId } from "react";
import {
  MARK_PATHS,
  MARK_CONNECTIONS,
  MARK_TRIM,
} from "../../../../brand/geometry";

export function StigmerLogo() {
  const maskId = useId();
  return (
    <div className="bg-primary mx-auto flex size-14 items-center justify-center rounded-xl">
      <svg
        width="28"
        height="28"
        viewBox="0 0 34 34"
        fill="currentColor"
        className="text-primary-foreground"
        aria-hidden="true"
      >
        <defs>
          <mask
            id={maskId}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="34"
            height="34"
          >
            {MARK_PATHS.slice(0, 4).map((d, index) => (
              <path
                key={index}
                d={d}
                fill="white"
                stroke="black"
                strokeWidth={MARK_TRIM}
                strokeLinejoin="round"
              />
            ))}
          </mask>
        </defs>
        {MARK_PATHS.map((d, index) => (
          <path
            key={index}
            d={d}
            mask={index < 4 ? `url(#${maskId})` : undefined}
          />
        ))}
        <g
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {MARK_CONNECTIONS.map(({ d, width }, index) => (
            <path key={index} d={d} strokeWidth={width} />
          ))}
        </g>
      </svg>
    </div>
  );
}
