/** Animate each refined brand form together with its connectors, preserving the eight-part reveal. */
import { useId } from "react";
import {
  MARK_PATHS,
  MARK_CONNECTIONS,
  MARK_TRIM,
} from "../../../../../brand/geometry";

export const StigmerMark = ({
  size,
  color = "#ffffff",
  reveal,
}: {
  size: number;
  color?: string;
  reveal?: (pathIndex: number) => number;
}) => {
  const maskId = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill={color}>
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
      {MARK_PATHS.map((d, index) => {
        const progress = reveal ? reveal(index) : 1;
        return (
          <g
            key={index}
            opacity={progress}
            transform={`translate(${17 * (1 - progress)} ${17 * (1 - progress)}) scale(${progress})`}
          >
            <path d={d} mask={index < 4 ? `url(#${maskId})` : undefined} />
            <g
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {MARK_CONNECTIONS.filter(({ part }) => part === index).map(
                ({ d: connector, width }, connectorIndex) => (
                  <path
                    key={connectorIndex}
                    d={connector}
                    strokeWidth={width}
                  />
                ),
              )}
            </g>
          </g>
        );
      })}
    </svg>
  );
};
