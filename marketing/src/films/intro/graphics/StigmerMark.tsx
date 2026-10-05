/** Animate each continuous brand outline, preserving the eight-part reveal. */
import { MARK_PATHS } from "../../../../../brand/geometry";

export const StigmerMark = ({
  size,
  color = "#ffffff",
  reveal,
}: {
  size: number;
  color?: string;
  reveal?: (pathIndex: number) => number;
}) => (
  <svg width={size} height={size} viewBox="0 0 34 34" fill={color}>
    {MARK_PATHS.map((d, index) => {
      const progress = reveal ? reveal(index) : 1;
      return (
        <path
          key={index}
          d={d}
          opacity={progress}
          transform={`translate(${17 * (1 - progress)} ${17 * (1 - progress)}) scale(${progress})`}
        />
      );
    })}
  </svg>
);
