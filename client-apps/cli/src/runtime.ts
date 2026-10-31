// Process-global CLI flags that cross-cutting modules (config, errors, logger)
// read without threading them through every call. Set once by the root
// preAction hook from the parsed global options and the command that runs.

let debug = false;
let standalone = false;
let actionCommand = "";

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

/** Record the path of the command that runs (`stigmer get`), for errors that name it. */
export function setActionCommand(path: string): void {
  actionCommand = path;
}

/** The path of the command that runs; "" before an action starts. */
export function actionCommandPath(): string {
  return actionCommand;
}
