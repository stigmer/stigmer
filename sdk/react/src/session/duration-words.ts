// A span of time as the session view says it: "42 s", "1 min 30 s",
// "1 h 5 min". Seconds are dropped past the hour, where they are noise.

/** `ms` in the session view's words (module header). */
export function durationWords(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}
