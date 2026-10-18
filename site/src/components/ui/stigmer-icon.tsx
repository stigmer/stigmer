/** Render the approved shaded mark in the dark documentation header. */
import { SHADED_PATHS } from "../../../../brand/shaded-geometry";

export function StigmerIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
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
      {SHADED_PATHS.map(({ d, dark }, index) => (
        <path key={index} d={d} fill={dark} />
      ))}
    </svg>
  );
}
