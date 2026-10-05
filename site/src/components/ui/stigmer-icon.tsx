/** Render the canonical smooth brand outlines using the surrounding theme color. */
import { MARK_PATHS } from "../../../../brand/geometry";

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
      {MARK_PATHS.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
