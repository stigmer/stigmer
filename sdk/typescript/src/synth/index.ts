// `@stigmer/sdk/synth` — the project-synthesis authoring API (the "producer").
//
// A user's entry point describes resources functionally and synthesizes them to
// proto `.pb` files that `stigmer apply` consumes:
//
//   import { defineProject } from "@stigmer/sdk/synth";
//
//   const project = defineProject((ctx) => {
//     ctx.skill.fromDir("./skills/calculator");
//     ctx.agent({ name: "support-bot", org: "acme", instructions: "…" });
//   });
//
//   await project.synth();
//
// `synth()` is EXPLICIT (no import-time / beforeExit magic): the builder runs
// lazily inside it, honoring `@stigmer/sdk`'s `sideEffects: false` and staying
// trivially testable via `synth({ outDir })` (DD-009 §1). Node-only — it writes
// files — and exported from the dedicated `/synth` subpath (DD-009 §2).

import { RegistrationContext } from "./context";
import { countRegistrations, type SynthCounts, writeRegistrations } from "./writer";
import type { ProjectContext } from "./context";

export type {
  ProjectContext,
  Registration,
  SkillFromDirOptions,
  SkillFromGitInput,
  SkillHandle,
} from "./context";
export type { SynthCounts, SynthFile } from "./writer";
export { serializeRegistrations } from "./writer";

/** Options for {@link ProjectApp.synth}. */
export interface SynthOptions {
  /** Output directory; defaults to `process.env.STIGMER_OUT_DIR`. */
  readonly outDir?: string;
  /** Default org for resources that omit one; defaults to `STIGMER_ORG_ID`. */
  readonly org?: string;
}

/** Outcome of a synthesis run. */
export interface SynthResult {
  /** Directory the `.pb` files were written to. */
  readonly outDir: string;
  /** Names of the written `.pb` files, in registration order. */
  readonly files: readonly string[];
  /** Per-kind resource counts. */
  readonly counts: SynthCounts;
}

/** A builder that registers resources on the given context (sync or async). */
export type ProjectBuilder = (ctx: ProjectContext) => void | Promise<void>;

/** A synthesizable project produced by {@link defineProject}. */
export interface ProjectApp {
  /** Run the builder and write the `.pb` artifacts; resolves to a summary. */
  synth(opts?: SynthOptions): Promise<SynthResult>;
}

/**
 * Define a synthesizable project. The `build` callback is NOT run here — it runs
 * lazily inside {@link ProjectApp.synth}, so importing the module has no side
 * effects and the same app can be synthesized to different out dirs in tests.
 */
export function defineProject(build: ProjectBuilder): ProjectApp {
  return {
    async synth(opts?: SynthOptions): Promise<SynthResult> {
      const outDir = opts?.outDir ?? process.env.STIGMER_OUT_DIR;
      if (outDir === undefined || outDir === "") {
        throw new Error(
          "no synthesis output directory\n\n" +
            "Run this project via `stigmer apply` (which sets STIGMER_OUT_DIR), " +
            "or call project.synth({ outDir }) with an explicit directory.",
        );
      }

      const ctx = new RegistrationContext(opts?.org ?? process.env.STIGMER_ORG_ID ?? "");
      await build(ctx);
      const registrations = ctx.collect();
      const files = writeRegistrations(outDir, registrations);
      return { outDir, files, counts: countRegistrations(registrations) };
    },
  };
}
