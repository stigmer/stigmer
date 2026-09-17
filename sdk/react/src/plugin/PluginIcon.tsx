/**
 * The plugin glyph: a puzzle piece, the icon Cursor, Claude Code and Codex
 * all use for the same package, drawn inline like `SkillDetailView`'s bolt
 * so the SDK adds no icon dependency for one shape.
 */
export function PluginIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2.5a1.5 1.5 0 0 1 3 0V4h2.5A1.5 1.5 0 0 1 13 5.5V8h-1.5a1.5 1.5 0 0 0 0 3H13v2.5a1.5 1.5 0 0 1-1.5 1.5H9v-1.5a1.5 1.5 0 0 0-3 0V15H3.5A1.5 1.5 0 0 1 2 13.5V11h1.5a1.5 1.5 0 0 0 0-3H2V5.5A1.5 1.5 0 0 1 3.5 4H6V2.5Z" />
    </svg>
  );
}
