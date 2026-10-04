/**
 * Pins what the agent-sandbox gateway sends to the Kubernetes API, over
 * the real client against a local HTTP server standing in for the API
 * server:
 *
 *   - the Sandbox's paths are agents.x-k8s.io/v1beta1 `sandboxes` in the
 *     configured namespace;
 *   - a patch is a JSON Patch, sent with its own content type, whose `add`
 *     operations replace the pod template whole and the operating mode;
 *   - a 404 read is "absent", a 409 create is "exists", a 404 create names
 *     the agent-sandbox install (quoting the API server's message or its
 *     plain text), a 404 delete is success, a delete propagates in the
 *     foreground, and any other refusal is passed on;
 *   - a Secret that exists is replaced whole;
 *   - the view reads a Sandbox's uid, mode (unset is Running) and deletion.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { KubeConfig } from "@kubernetes/client-node";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentSandboxNotInstalledError,
  agentSandboxViewOf,
  newAgentSandboxClientGateway,
} from "../gateway.js";
import type { AgentSandboxResource } from "../resource.js";

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly contentType: string | undefined;
  readonly body: unknown;
}

type Reply = { status: number; body?: unknown; text?: string };

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : (JSON.parse(text) as unknown);
}

async function apiServer(
  reply: (seen: Seen) => Reply,
): Promise<{ seen: Seen[]; kubeConfig: KubeConfig }> {
  const seen: Seen[] = [];
  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      const entry: Seen = {
        method: request.method ?? "",
        url: request.url ?? "",
        contentType: request.headers["content-type"],
        body,
      };
      seen.push(entry);
      const answer = reply(entry);
      if (answer.text !== undefined) {
        response.writeHead(answer.status, { "content-type": "text/plain" });
        response.end(answer.text);
        return;
      }
      response.writeHead(answer.status, { "content-type": "application/json" });
      response.end(JSON.stringify(answer.body ?? {}));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const kubeConfig = new KubeConfig();
  kubeConfig.loadFromOptions({
    clusters: [
      { name: "fake", server: `http://127.0.0.1:${port}`, skipTLSVerify: true },
    ],
    users: [{ name: "fake" }],
    contexts: [{ name: "fake", cluster: "fake", user: "fake" }],
    currentContext: "fake",
  });
  return { seen, kubeConfig };
}

const SANDBOXES = "/apis/agents.x-k8s.io/v1beta1/namespaces/sbx/sandboxes";
const sandboxResource: AgentSandboxResource = {
  apiVersion: "agents.x-k8s.io/v1beta1",
  kind: "Sandbox",
  metadata: { name: "sbx-ses-1", labels: {} },
  spec: {
    podTemplate: { metadata: { labels: {} }, spec: { containers: [] } },
    operatingMode: "Suspended",
  },
};
const status = (code: number, message: string): Reply => ({
  status: code,
  body: { kind: "Status", apiVersion: "v1", status: "Failure", message, code },
});
const sandboxObject = {
  metadata: { name: "sbx-ses-1", uid: "uid-1" },
  spec: { operatingMode: "Suspended" },
};

describe("the Sandbox calls", () => {
  it("reads a Sandbox, and a 404 is absent", async () => {
    const { seen, kubeConfig } = await apiServer((request) =>
      request.url.endsWith("/sbx-ses-1")
        ? { status: 200, body: sandboxObject }
        : status(404, "not found"),
    );
    const gateway = newAgentSandboxClientGateway(kubeConfig, "sbx");
    expect(await gateway.getSandbox("sbx-ses-1")).toEqual({
      name: "sbx-ses-1",
      uid: "uid-1",
      operatingMode: "Suspended",
      deleting: false,
      labels: {},
    });
    expect(await gateway.getSandbox("sbx-ses-2")).toBeUndefined();
    expect(seen.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      `GET ${SANDBOXES}/sbx-ses-1`,
      `GET ${SANDBOXES}/sbx-ses-2`,
    ]);
  });

  it("creates a Sandbox; a 409 is 'exists' and a 404 names the agent-sandbox install", async () => {
    const replies: Reply[] = [
      { status: 201, body: sandboxObject },
      status(409, "already exists"),
      status(404, "the server could not find the requested resource"),
    ];
    const { seen, kubeConfig } = await apiServer(
      () => replies.shift() ?? status(500, "unexpected"),
    );
    const gateway = newAgentSandboxClientGateway(kubeConfig, "sbx");
    const resource: AgentSandboxResource = {
      apiVersion: "agents.x-k8s.io/v1beta1",
      kind: "Sandbox",
      metadata: { name: "sbx-ses-1", labels: {} },
      spec: {
        podTemplate: { metadata: { labels: {} }, spec: { containers: [] } },
        operatingMode: "Suspended",
      },
    };
    expect((await gateway.createSandbox(resource))?.uid).toBe("uid-1");
    expect(await gateway.createSandbox(resource)).toBeUndefined();
    await expect(gateway.createSandbox(resource)).rejects.toThrow(
      "agent-sandbox's Sandbox resource (sandboxes.agents.x-k8s.io/v1beta1) cannot be created in namespace 'sbx': install agent-sandbox in the cluster (its core manifest, sandbox.yaml) and check that the namespace exists (HTTP 404: the server could not find the requested resource)",
    );
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toBe(SANDBOXES);
    expect(seen[0]?.body).toEqual(resource);
  });

  it("patches with a JSON Patch, its content type set, replacing the template whole and then the mode", async () => {
    const { seen, kubeConfig } = await apiServer(() => ({
      status: 200,
      body: sandboxObject,
    }));
    const gateway = newAgentSandboxClientGateway(kubeConfig, "sbx");
    const podTemplate = {
      metadata: { labels: { a: "b" } },
      spec: { containers: [] },
    };
    await gateway.patchSandbox("sbx-ses-1", {
      operatingMode: "Running",
      podTemplate,
    });
    await gateway.patchSandbox("sbx-ses-1", { operatingMode: "Suspended" });
    expect(
      seen.map((entry) => [entry.method, entry.url, entry.contentType]),
    ).toEqual([
      ["PATCH", `${SANDBOXES}/sbx-ses-1`, "application/json-patch+json"],
      ["PATCH", `${SANDBOXES}/sbx-ses-1`, "application/json-patch+json"],
    ]);
    expect(seen[0]?.body).toEqual([
      { op: "add", path: "/spec/podTemplate", value: podTemplate },
      { op: "add", path: "/spec/operatingMode", value: "Running" },
    ]);
    expect(seen[1]?.body).toEqual([
      { op: "add", path: "/spec/operatingMode", value: "Suspended" },
    ]);
  });

  it("deletes in the foreground, and a missing Sandbox is success", async () => {
    const replies: Reply[] = [
      { status: 200, body: {} },
      status(404, "not found"),
    ];
    const { seen, kubeConfig } = await apiServer(
      () => replies.shift() ?? status(500, "unexpected"),
    );
    const gateway = newAgentSandboxClientGateway(kubeConfig, "sbx");
    await gateway.deleteSandbox("sbx-ses-1");
    await gateway.deleteSandbox("sbx-ses-1");
    expect(seen[0]?.method).toBe("DELETE");
    expect(seen[0]?.url).toBe(
      `${SANDBOXES}/sbx-ses-1?propagationPolicy=Foreground`,
    );
  });

  it("a server error is passed on", async () => {
    const { kubeConfig } = await apiServer(() => status(500, "boom"));
    const gateway = newAgentSandboxClientGateway(kubeConfig, "sbx");
    await expect(gateway.getSandbox("sbx-ses-1")).rejects.toThrow();
    await expect(gateway.deleteSandbox("sbx-ses-1")).rejects.toThrow();
    const created = gateway.createSandbox(sandboxResource);
    await expect(created).rejects.toThrow();
    await expect(created).rejects.not.toThrow(AgentSandboxNotInstalledError);
    await expect(
      gateway.applySecret({ metadata: { name: "sbx-ses-1-env" } }),
    ).rejects.toThrow();
  });

  it("names the API server's plain-text answer when a create finds no resource type", async () => {
    const { kubeConfig } = await apiServer(() => ({
      status: 404,
      text: "404 page not found\n",
    }));
    const gateway = newAgentSandboxClientGateway(kubeConfig, "sbx");
    await expect(gateway.createSandbox(sandboxResource)).rejects.toThrow(
      "check that the namespace exists (HTTP 404: 404 page not found)",
    );
  });
});

describe("the Secret", () => {
  it("is created, and replaced whole when it exists", async () => {
    const replies: Reply[] = [
      { status: 201, body: {} },
      status(409, "exists"),
      { status: 200, body: {} },
    ];
    const { seen, kubeConfig } = await apiServer(
      () => replies.shift() ?? status(500, "unexpected"),
    );
    const gateway = newAgentSandboxClientGateway(kubeConfig, "sbx");
    const secret = {
      metadata: { name: "sbx-ses-1-env" },
      stringData: { STIGMER_TOKEN: "tok" },
    };
    await gateway.applySecret(secret);
    await gateway.applySecret(secret);
    expect(seen.map((entry) => `${entry.method} ${entry.url}`)).toEqual([
      "POST /api/v1/namespaces/sbx/secrets",
      "POST /api/v1/namespaces/sbx/secrets",
      "PUT /api/v1/namespaces/sbx/secrets/sbx-ses-1-env",
    ]);
    expect(seen[2]?.body).toMatchObject(secret);
  });
});

describe("the view of a Sandbox", () => {
  it("reads an unset mode as Running, a deletion timestamp as deleting, and the labels", () => {
    expect(
      agentSandboxViewOf({
        metadata: {
          name: "n",
          uid: "u",
          deletionTimestamp: "2026-10-04T00:00:00Z",
          labels: { a: "b", n: 1 },
        },
        spec: {},
      }),
    ).toEqual({
      name: "n",
      uid: "u",
      operatingMode: "Running",
      deleting: true,
      labels: { a: "b" },
    });
  });

  it("refuses an object with no name or uid", () => {
    expect(() => agentSandboxViewOf({ metadata: { name: "n" } })).toThrow(
      "a Sandbox from the cluster carries no name or uid",
    );
  });
});
