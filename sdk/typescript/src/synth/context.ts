// ProjectContext — the resource-registration surface handed to a
// `defineProject` builder.
//
// Each `ctx.<kind>()` records one ergonomic `*Input` (the very types the
// `@stigmer/sdk` resource clients already accept) in registration order;
// `ctx.skill.fromDir` / `ctx.skill.fromGit` record a `SkillSynth` handover
// message (the SDK→CLI contract from `synth.proto`). The writer later turns
// these registrations into the `.pb` files the CLI consumes. Reusing the
// `*Input` types — not a new authoring vocabulary — keeps the synthesis surface
// identical to the imperative SDK, so there is exactly one way to describe a
// resource in TypeScript (DD-009 §1, §4).
//
// Org defaults from `STIGMER_ORG_ID` when a resource omits it, mirroring the
// CLI's org injection (apply.ts `injectOrg`) so a project authored without an
// explicit org still synthesizes to valid protos when run via `stigmer apply`.

import { create } from "@bufbuild/protobuf";
import {
  GitSchema,
  LocalDirSchema,
  type SkillSynth,
  SkillSynthSchema,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/synth_pb";
import type { AgentInput } from "../gen/agent";
import type { McpServerInput } from "../gen/mcpserver";
import type { WorkflowInput } from "../gen/workflow";

/** Options for registering a skill from a local directory. */
export interface SkillFromDirOptions {
  /** Mutable version tag (the CLI defaults this to "latest" at push time). */
  readonly tag?: string;
}

/** Input for registering a skill sourced from a remote git repository. */
export interface SkillFromGitInput {
  /** Git repository URL (HTTPS or SSH). */
  readonly url: string;
  /** Tag, branch, or commit SHA; empty resolves to the default branch. */
  readonly ref?: string;
  /** Subdirectory within the repo that holds SKILL.md; empty = repo root. */
  readonly subdir?: string;
  /** Mutable version tag (the CLI defaults this to "latest" at push time). */
  readonly tag?: string;
}

// Opaque registration record returned by ctx.skill.* so the builder reads
// naturally (and to leave room for future linkage ergonomics). Agents reference
// skills by slug via AgentInput.skillRefs, exactly as in the declarative track —
// a skill's slug is its SKILL.md name, which the backend assigns at push time.
export interface SkillHandle {
  readonly kind: "skill";
  readonly synth: SkillSynth;
}

/** One ordered registration captured by the context. */
export type Registration =
  | { readonly kind: "agent"; readonly input: AgentInput }
  | { readonly kind: "workflow"; readonly input: WorkflowInput }
  | { readonly kind: "mcpServer"; readonly input: McpServerInput }
  | { readonly kind: "skill"; readonly synth: SkillSynth };

/** The resource-registration API passed to a `defineProject` builder. */
export interface ProjectContext {
  /** Register an agent for synthesis. */
  agent(input: AgentInput): void;
  /** Register a workflow for synthesis. */
  workflow(input: WorkflowInput): void;
  /** Register an MCP server for synthesis. */
  mcpServer(input: McpServerInput): void;
  /** Register skills sourced from a local directory or a git repository. */
  readonly skill: {
    fromDir(path: string, opts?: SkillFromDirOptions): SkillHandle;
    fromGit(input: SkillFromGitInput): SkillHandle;
  };
}

/**
 * Concrete {@link ProjectContext} that accumulates registrations in order.
 * `defineProject` runs the user's builder against one of these, then hands the
 * collected registrations to the writer.
 */
export class RegistrationContext implements ProjectContext {
  private readonly registrations: Registration[] = [];
  private readonly defaultOrg: string;

  constructor(defaultOrg: string = process.env.STIGMER_ORG_ID ?? "") {
    this.defaultOrg = defaultOrg;
  }

  agent(input: AgentInput): void {
    this.registrations.push({ kind: "agent", input: this.withOrg(input) });
  }

  workflow(input: WorkflowInput): void {
    this.registrations.push({ kind: "workflow", input: this.withOrg(input) });
  }

  mcpServer(input: McpServerInput): void {
    this.registrations.push({ kind: "mcpServer", input: this.withOrg(input) });
  }

  readonly skill = {
    fromDir: (path: string, opts?: SkillFromDirOptions): SkillHandle => {
      const synth = create(SkillSynthSchema, {
        source: { case: "local", value: create(LocalDirSchema, { path }) },
        tag: opts?.tag ?? "",
      });
      this.registrations.push({ kind: "skill", synth });
      return { kind: "skill", synth };
    },
    fromGit: (input: SkillFromGitInput): SkillHandle => {
      const synth = create(SkillSynthSchema, {
        source: {
          case: "git",
          value: create(GitSchema, {
            url: input.url,
            ref: input.ref ?? "",
            subdir: input.subdir ?? "",
          }),
        },
        tag: input.tag ?? "",
      });
      this.registrations.push({ kind: "skill", synth });
      return { kind: "skill", synth };
    },
  };

  /** Registrations captured so far, in builder-call order. */
  collect(): readonly Registration[] {
    return this.registrations;
  }

  // Fill org from STIGMER_ORG_ID only when the resource left it blank; an
  // explicit org always wins (the CLI later warns on org mismatch, not here).
  private withOrg<T extends { org: string }>(input: T): T {
    if (this.defaultOrg !== "" && (input.org === undefined || input.org === "")) {
      return { ...input, org: this.defaultOrg };
    }
    return input;
  }
}
