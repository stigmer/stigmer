/** Keep public-page branding in the console shell, using the canonical three-fin outline. */
import { MARK_PATHS } from "../../../../brand/geometry";

export function StigmerLogo() {
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
        {MARK_PATHS.map((d, index) => (
          <path key={index} d={d} />
        ))}
      </svg>
    </div>
  );
}
