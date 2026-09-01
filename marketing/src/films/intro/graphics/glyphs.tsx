/**
 * The two environment glyphs the diagrams share (S2c, S5d): a laptop and
 * a cloud, drawn in the film's line style — 2.5px strokes, rounded joins,
 * no fills — so they read as diagram, not illustration.
 */
const stroke = (color: string) =>
  ({
    fill: "none",
    stroke: color,
    strokeWidth: 2.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  }) as const;

export const LaptopGlyph = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <rect x="9" y="10" width="30" height="20" rx="2.5" {...stroke(color)} />
    <path d="M5 36h38l-3.5-6h-31L5 36Z" {...stroke(color)} />
  </svg>
);

export const CloudGlyph = ({ size, color }: { size: number; color: string }) => (
  <svg width={size} height={size} viewBox="0 0 48 48">
    <path
      d="M14 34a8 8 0 0 1-1-15.9A11 11 0 0 1 34.5 16 9 9 0 0 1 34 34H14Z"
      {...stroke(color)}
    />
  </svg>
);
