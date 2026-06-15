// Public surface of @stigmer/cli.
//
// The CLI is primarily consumed as the `stigmer` bin, but exposing the program
// builder lets tests drive the full command tree in-process and lets embedders
// compose it.

export { buildProgram } from "./program.js";
export { VERSION } from "./version.js";
