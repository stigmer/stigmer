/**
 * The growth gate: whether this server may grow its setup right now (a new
 * team, a new or changed federation issuer).
 *
 * A host whose right to grow is bounded (a self-hosted server whose license
 * has run out) refuses growth and nothing else: everything that exists keeps
 * working, people keep signing in, being invited, joining teams, and every
 * removal stays open, so a late renewal never stops a new hire's onboarding
 * or an admin cutting off a compromised provider. The host decides and
 * words the refusal; these lanes only ask, through a port the host fills,
 * and with no gate (a host with no license) every act is allowed.
 *
 * The step sits last in the create chains of the kinds that grow a setup
 * (team create, after its plan gate; federation issuer create and update),
 * so nothing is written before it refuses, and apply reaches it through the
 * create or update chain it delegates to. Invitations, team members and
 * every delete are never gated.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import type { PipelineStep } from "@stigmer/server";

export interface GrowthGate {
  /** Throws the host's refusal when the server may not grow right now; returns otherwise. */
  assertGrowthAllowed(): void;
}

/** The chain step that asks the gate; named for every chain it sits in. */
export function newGrowthGateStep<S extends DescMessage>(gate: GrowthGate): PipelineStep<S> {
  return {
    name: "GrowthGate",
    async execute(): Promise<void> {
      gate.assertGrowthAllowed();
    },
  };
}
