/**
 * `value` without its trailing run of `char`. A `/x+$/` regex rescans the run
 * from every starting position, so a long run costs quadratic time; this walks
 * it once.
 */
export function trimTrailing(value: string, char: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === char) end -= 1;
  return end === value.length ? value : value.slice(0, end);
}
