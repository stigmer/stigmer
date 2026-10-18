/** Show the shaded avatar on its own graphite background in either console theme. */
export function StigmerLogo() {
  return (
    // The static export serves the canonical avatar without an image optimization service.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand-avatar.png"
      width={56}
      height={56}
      alt="Stigmer"
      className="mx-auto rounded-xl"
    />
  );
}
