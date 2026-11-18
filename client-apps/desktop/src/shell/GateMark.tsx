// The app's mark on every screen the kit's standalone frame draws for the
// desktop app (the gates, the server screens, the sign-in, the boot
// failure), at the frame's 40px. Its own module, so the screens before the
// app (the boot failure above everything) import nothing of the app's
// sign-in to show it.

/** The app's mark, at the frame's 40px. */
export function GateMark() {
  return <img src="/app-icon-light.svg" alt="Stigmer" width={40} height={40} className="size-10 rounded-xl" />;
}
