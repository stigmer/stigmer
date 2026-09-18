// Pins the Python SDK emitter's cross-package import derivation. A message
// referenced from another proto package is imported from the module of the
// file that declares it, never from an assumed `spec_pb2`: a package may keep
// its messages in topic files (invocation.proto, workspace.proto,
// entitlement.proto), and an import from the wrong module is a syntax-valid
// AttributeError that surfaces only when the input builder runs. The three
// cases here are the ones the published SDK once got wrong and the one it got
// right.
import { describe, expect, it } from "vitest";

import { pyProtoFileToModule, pyProtoImportLine, pyProtoModuleAlias } from "./lang-names.js";

describe("Python cross-package imports", () => {
  it("names the module after the declaring proto file", () => {
    expect(pyProtoFileToModule("ai/stigmer/agentic/agentexecution/v1/invocation.proto")).toBe(
      "invocation_pb2",
    );
    expect(pyProtoFileToModule("ai/stigmer/agentic/session/v1/workspace.proto")).toBe(
      "workspace_pb2",
    );
    expect(pyProtoFileToModule("ai/stigmer/platform/v1/entitlement.proto")).toBe(
      "entitlement_pb2",
    );
  });

  it("aliases per package and module, so two topic files of one package coexist", () => {
    expect(pyProtoModuleAlias("ai.stigmer.platform.v1", "entitlement_pb2")).toBe(
      "platform_entitlement_pb2",
    );
    expect(pyProtoModuleAlias("ai.stigmer.platform.v1", "license_pb2")).toBe(
      "platform_license_pb2",
    );
    expect(pyProtoModuleAlias("ai.stigmer.agentic.agentexecution.v1", "invocation_pb2")).toBe(
      "agentexecution_invocation_pb2",
    );
  });

  it("keeps spec_pb2 as the default for a message declared in the package's spec file", () => {
    expect(pyProtoModuleAlias("ai.stigmer.agentic.agent.v1")).toBe("agent_spec_pb2");
    expect(pyProtoImportLine("ai.stigmer.agentic.agent.v1")).toBe(
      "from ai.stigmer.agentic.agent.v1 import spec_pb2 as agent_spec_pb2",
    );
  });

  it("writes the import line from the declaring module", () => {
    expect(pyProtoImportLine("ai.stigmer.agentic.session.v1", "workspace_pb2")).toBe(
      "from ai.stigmer.agentic.session.v1 import workspace_pb2 as session_workspace_pb2",
    );
  });
});
