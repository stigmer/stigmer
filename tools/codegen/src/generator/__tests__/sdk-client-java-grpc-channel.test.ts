/**
 * Pins how the Java SDK generator names gRPC's channel type. Every client's
 * constructor takes an `io.grpc.Channel`; a resource whose own package has a
 * message named Channel (the Channel kind) imports that message, so the
 * client names gRPC's type fully qualified instead of importing a second
 * `Channel`, which javac would refuse as ambiguous. Every other client keeps
 * the plain import.
 *
 * The generator runs over the real schemas into a temporary directory, and
 * these cases read what it wrote.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runSDKClientJavaGeneration } from "../sdk-client-java.js";

const SCHEMAS = path.resolve(__dirname, "../../../schemas");

describe("the Java SDK's clients name gRPC's channel type without shadowing a Channel message", () => {
  let root: string;

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "codegen-java-channel-"));
    runSDKClientJavaGeneration(SCHEMAS, root);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("the Channel client imports the Channel message and names io.grpc.Channel in full", () => {
    const source = fs.readFileSync(path.join(root, "ChannelClient.java"), "utf8");
    expect(source).toContain("import ai.stigmer.agentic.channel.v1.Channel;\n");
    expect(source).not.toContain("import io.grpc.Channel;\n");
    expect(source).toContain("ChannelClient(io.grpc.Channel channel) {\n");
  });

  it("a client with no Channel message imports io.grpc.Channel", () => {
    const source = fs.readFileSync(path.join(root, "AgentClient.java"), "utf8");
    expect(source).toContain("import io.grpc.Channel;\n");
    expect(source).toContain("AgentClient(Channel channel) {\n");
  });
});
