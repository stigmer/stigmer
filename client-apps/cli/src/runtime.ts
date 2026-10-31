// Process-global CLI flags that cross-cutting modules (config, errors, logger)
// read without threading them through every call. Set once by the root
// preAction hook from the parsed global options and the command that runs.
//
// Two records are written later, by the command itself, so an error can
// name what was actually tried: the server address the backend client
// dials (and where that address came from), recorded when the client is
// made, and the resource type a get, delete or download resolved.

let debug = false;
let standalone = false;
let actionCommand = "";
let serverAddress: ServerAddress | undefined;
let resourceType = "";

/**
 * Where the address the backend client dials came from: the active
 * backend's kind, or the STIGMER_SERVER_ADDRESS override.
 */
export type ServerAddressSource = "local" | "cloud" | "selfhost" | "environment";

/** The server address a backend client dials, as resolved, with its source. */
export interface ServerAddress {
  readonly address: string;
  readonly source: ServerAddressSource;
}

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

/** Record the address the backend client dials; undefined forgets it (tests). */
export function setServerAddress(value: ServerAddress | undefined): void {
  serverAddress = value;
}

/** The address the backend client dials; undefined when no client was made. */
export function dialedServerAddress(): ServerAddress | undefined {
  return serverAddress;
}

/** Record the resource type the running command resolved, as `stigmer list` spells it ("" forgets it). */
export function setActionResourceType(type: string): void {
  resourceType = type;
}

/** The resource type the running command resolved; "" when none was. */
export function actionResourceType(): string {
  return resourceType;
}
