// Process-global CLI flags that cross-cutting modules (config, errors, logger)
// read without threading them through every call. Set once by the root
// preAction hook from the parsed global options. Mirrors the Go CLI's atomic
// `standalone`/`debug` globals in internal/cli/config and clierr.

let debug = false;
let standalone = false;

export function setDebug(value: boolean): void {
  debug = value;
}

export function isDebug(): boolean {
  return debug;
}

export function setStandalone(value: boolean): void {
  standalone = value;
}

export function isStandalone(): boolean {
  return standalone;
}
