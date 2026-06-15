// Node-only entry point for the project-synthesis authoring API.
//
// Re-exports `@stigmer/sdk/synth` (see ./synth/index.ts). Kept as a thin
// top-level module so the package `exports` map can expose `"./synth"` the same
// way `"./node"` maps to ./node.ts — a capability subpath, not a client noun
// (DD-009 §2).

export * from "./synth/index.js";
