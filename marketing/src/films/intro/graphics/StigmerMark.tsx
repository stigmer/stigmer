/** Reveal the shaded mark as one object so overlapping faces never brighten during a fade. */
import { SHADED_PATHS } from "../../../../../brand/shaded-geometry";

export const StigmerMark = ({
  size,
  reveal,
}: {
  size: number;
  reveal?: (pathIndex: number) => number;
}) => {
  const progress = reveal ? reveal(0) : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 34 34">
      <g
        opacity={progress}
        transform={`translate(${17 * (1 - progress)} ${17 * (1 - progress)}) scale(${progress})`}
      >
        {SHADED_PATHS.map(({ d, dark }, index) => (
          <path key={index} d={d} fill={dark} />
        ))}
      </g>
    </svg>
  );
};
