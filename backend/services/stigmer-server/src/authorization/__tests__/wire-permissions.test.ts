/**
 * Pins that every question the wire can ask this edition's authorizer
 * has a line in the model: for every `rpc.config`-annotated method the
 * open-source server SERVES whose annotation names a static kind this
 * edition serves, the permission is a relation that kind's transcript
 * declares. A relation the kind does not define answers `deny` here
 * (evaluator.ts) — an RPC annotated with such a pair would refuse every
 * caller, green on the permissive `local*` targets and dark only under
 * enforcement, so the gap is caught at the registry instead of on a
 * self-host.
 *
 * Scope follows authorize-annotation-completeness.test.ts: the empty
 * composition's routes, replayed into a recorder, are exactly the methods
 * the OSS Authorize step governs. Outside the pin, each for a stated
 * reason: `is_public` and `is_skip_authorization` methods (the annotation
 * is never resolved); a kind the edition does not serve (`platform`; the
 * driver refuses it before any evaluation, so under the built-in posture
 * nobody holds a platform permission); a kind named by
 * `resource_kind_path` (the IamPolicy lane's — the kind is the request's,
 * and the target's own declaration answers at run time).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { getOption, hasOption } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  config as rpcAuthorizationConfig,
  is_public,
  is_skip_authorization,
} from "@stigmer/protos/ai/stigmer/commons/rpc/method_options_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import {
  baseConfig,
  servedServices,
  silentLogger,
} from "../../extensions/__tests__/composed-support.js";
import {
  kindEnumName,
  kindServedByEdition,
} from "../../pipeline/apiresource-meta.js";
import { declarationFor } from "../model/index.js";

/** One annotated, served, statically-targeted method: the question the wire asks. */
interface WireQuestion {
  readonly method: string;
  readonly kind: ApiResourceKind;
  readonly permission: string;
}

describe("every static (kind, permission) the served RPCs ask about is a declared relation", () => {
  let dir: string;
  let server: ComposedServer;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "wire-permissions-test-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  function wireQuestions(): WireQuestion[] {
    const questions: WireQuestion[] = [];
    for (const service of servedServices(server.routes)) {
      for (const method of service.methods) {
        if (
          !hasOption(method, rpcAuthorizationConfig) ||
          getOption(method, is_public) ||
          getOption(method, is_skip_authorization)
        ) {
          continue;
        }
        const config = getOption(method, rpcAuthorizationConfig);
        if (
          config.resourceKind === ApiResourceKind.api_resource_kind_unknown ||
          !kindServedByEdition(config.resourceKind, ServerEdition.oss)
        ) {
          continue;
        }
        questions.push({
          method: `${service.typeName}/${method.name}`,
          kind: config.resourceKind,
          permission: IamPermission[config.permission] ?? "",
        });
      }
    }
    return questions;
  }

  it("names a declared relation for every question, with none undeclared", () => {
    const questions = wireQuestions();
    expect(questions.length).toBeGreaterThan(60);
    const undeclared = questions
      .filter(
        (q) => declarationFor(q.kind)?.relations.has(q.permission) !== true,
      )
      .map(
        (q) =>
          `${q.method} asks ${q.permission} on ${kindEnumName(q.kind)}, which its transcript does not declare`,
      );
    expect(undeclared).toEqual([]);
  });

  it("asks about every served kind the model declares except the one no RPC targets statically", () => {
    // iam_policy's RPCs target the policy's RESOURCE (`resource_kind_path`
    // or the load-then-authorize `get`). Every other declared kind is asked
    // about by at least one static annotation — execution_context through
    // its `get` and `delete`; its runner-token lane stays a skip.
    const asked = new Set(wireQuestions().map((q) => kindEnumName(q.kind)));
    expect([...asked].sort()).toEqual(
      [
        "agent",
        "agent_channel",
        "agent_execution",
        "agent_instance",
        "agent_share",
        "api_key",
        "artifact",
        "channel_app",
        "environment",
        "execution_context",
        "identity_account",
        "mcp_server",
        "memory",
        "oauth_app",
        "organization",
        "platform_client",
        "plugin",
        "schedule",
        "session",
        "skill",
        "workflow",
        "workflow_execution",
        "workflow_instance",
      ].sort(),
    );
  });
});
