// Writer — turns ordered {@link Registration}s into the proto `.pb` files the
// CLI's synthesis reader consumes.
//
// Each kind gets its own zero-based counter, producing `agent-N.pb`,
// `workflow-N.pb`, `mcpserver-N.pb`, and `skill-N.pb`. These names and the
// binary encoding are the SDK↔CLI handoff contract: they must match the reader's
// glob/sort (`<kind>-*.pb`, lexically sorted) on both the Go and TS consumers
// (reader.go / reader.ts). Resources are serialized via protobuf-es `toBinary`
// (DD-009 §3); the full proto is built by reusing the generated, package-private
// `build<Kind>Proto` helpers (DD-009 §4) so synthesis and the imperative SDK
// share one field mapping. Skills are already `SkillSynth` messages and are
// encoded directly.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toBinary } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { SkillSynthSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/synth_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { buildAgentProto } from "../gen/agent.js";
import { buildMcpServerProto } from "../gen/mcpserver.js";
import { buildWorkflowProto } from "../gen/workflow.js";
import type { Registration } from "./context.js";

/** One serialized synthesis artifact: its file name and binary proto bytes. */
export interface SynthFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Per-kind counts of synthesized resources. */
export interface SynthCounts {
  readonly agents: number;
  readonly workflows: number;
  readonly mcpServers: number;
  readonly skills: number;
}

/**
 * Serialize registrations into named `.pb` artifacts, in registration order,
 * with a per-kind zero-based index. Pure (no filesystem) so it is trivially
 * unit-testable and reusable by callers that want the bytes without writing.
 */
export function serializeRegistrations(registrations: readonly Registration[]): SynthFile[] {
  const next = { agent: 0, workflow: 0, mcpServer: 0, skill: 0 };
  const files: SynthFile[] = [];
  for (const reg of registrations) {
    switch (reg.kind) {
      case "agent":
        files.push({ name: `agent-${next.agent++}.pb`, bytes: toBinary(AgentSchema, buildAgentProto(reg.input)) });
        break;
      case "workflow":
        files.push({
          name: `workflow-${next.workflow++}.pb`,
          bytes: toBinary(WorkflowSchema, buildWorkflowProto(reg.input)),
        });
        break;
      case "mcpServer":
        files.push({
          name: `mcpserver-${next.mcpServer++}.pb`,
          bytes: toBinary(McpServerSchema, buildMcpServerProto(reg.input)),
        });
        break;
      case "skill":
        files.push({ name: `skill-${next.skill++}.pb`, bytes: toBinary(SkillSynthSchema, reg.synth) });
        break;
    }
  }
  return files;
}

/** Tally registrations by kind (for the synth result summary). */
export function countRegistrations(registrations: readonly Registration[]): SynthCounts {
  let agents = 0;
  let workflows = 0;
  let mcpServers = 0;
  let skills = 0;
  for (const reg of registrations) {
    if (reg.kind === "agent") agents++;
    else if (reg.kind === "workflow") workflows++;
    else if (reg.kind === "mcpServer") mcpServers++;
    else skills++;
  }
  return { agents, workflows, mcpServers, skills };
}

/**
 * Serialize and write all registrations into `outDir`, returning the written
 * file names. The directory is created if absent (idempotent) — synthesis owns
 * its output target, like CDK's `app.synth()` creating `cdk.out`.
 */
export function writeRegistrations(outDir: string, registrations: readonly Registration[]): string[] {
  const files = serializeRegistrations(registrations);
  mkdirSync(outDir, { recursive: true });
  for (const file of files) {
    writeFileSync(join(outDir, file.name), file.bytes);
  }
  return files.map((file) => file.name);
}
