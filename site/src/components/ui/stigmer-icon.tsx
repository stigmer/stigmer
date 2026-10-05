/** Render the refined brand mark with theme-aware color and instance-safe mask IDs. */
"use client";

import { useId } from "react";
import {
  MARK_PATHS,
  MARK_CONNECTIONS,
  MARK_TRIM,
} from "../../../../brand/geometry";

export function StigmerIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const maskId = useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 34 34"
      fill="currentColor"
      className={className}
      aria-label="Stigmer"
      role="img"
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
  );
}
