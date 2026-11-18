/** Show the shaded avatar on its own graphite background in either console theme. */
export function StigmerLogo({ size = 56 }: { size?: number } = {}) {
  return (
    // The static export serves the canonical avatar without an image optimization service.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand-avatar.png"
      width={size}
      height={size}
      alt="Stigmer"
      className="mx-auto rounded-xl"
    />
  );
}
