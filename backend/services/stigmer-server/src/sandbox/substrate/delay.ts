/**
 * The real clock's wait, the one default every part of the substrate driver
 * uses where its tests inject a fake (`sleep` options in driver.ts,
 * template.ts and push.ts), so the driver waits in one way everywhere.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
