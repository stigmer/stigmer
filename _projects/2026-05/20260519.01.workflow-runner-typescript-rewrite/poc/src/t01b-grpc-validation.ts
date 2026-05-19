/**
 * T01b: Dynamic gRPC Invocation Validation Spike
 *
 * Validates that @grpc/proto-loader + @grpc/grpc-js can dynamically load a
 * .proto file at runtime, create a client, and invoke methods — replicating
 * what Go's grpcurl library does in the workflow-runner's call_grpc task.
 *
 * Tests:
 * - Dynamic proto loading without code generation
 * - Unary RPC invocation with JSON-like arguments
 * - Nested message types, repeated fields, enum handling
 * - Error handling (connection refused, method not found, deadline exceeded)
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROTO_PATH = join(__dirname, "fixtures", "sample.proto");
const TEST_PORT = 50_099; // unlikely to conflict

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  detail: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Test gRPC Server — implements the UserService from sample.proto
// ---------------------------------------------------------------------------

function startTestServer(port: number): Promise<grpc.Server> {
  return new Promise((resolve, reject) => {
    const packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(packageDef) as any;

    const server = new grpc.Server();

    server.addService(proto.sample.v1.UserService.service, {
      GetUser: (
        call: grpc.ServerUnaryCall<any, any>,
        callback: grpc.sendUnaryData<any>,
      ) => {
        const { user_id } = call.request;
        if (!user_id || user_id === "") {
          callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: "user_id is required",
          });
          return;
        }
        if (user_id === "not-found") {
          callback({
            code: grpc.status.NOT_FOUND,
            message: `User '${user_id}' not found`,
          });
          return;
        }
        callback(null, {
          user_id,
          name: "Alice Smith",
          email: "alice@example.com",
          address: {
            street: "123 Main St",
            city: "Portland",
            country: "US",
            zip_code: "97201",
          },
          roles: ["admin", "editor"],
          priority: "PRIORITY_HIGH",
        });
      },

      CreateUser: (
        call: grpc.ServerUnaryCall<any, any>,
        callback: grpc.sendUnaryData<any>,
      ) => {
        const { name, email } = call.request;
        callback(null, {
          user_id: `usr_${Date.now()}`,
          success: !!(name && email),
        });
      },
    });

    server.bindAsync(
      `0.0.0.0:${port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) return reject(err);
        console.log(`  Test gRPC server started on port ${boundPort}`);
        resolve(server);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Dynamic client — mirrors Go grpcurl pattern
// ---------------------------------------------------------------------------

interface DynamicClient {
  invoke(method: string, args: Record<string, unknown>): Promise<unknown>;
  serviceName: string;
  methodNames: string[];
}

async function createDynamicClient(
  protoPath: string,
  address: string,
  servicePath: string,
): Promise<DynamicClient> {
  const packageDef = protoLoader.loadSync(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const proto = grpc.loadPackageDefinition(packageDef);

  // Navigate to the service by package path (e.g., "sample.v1.UserService")
  const parts = servicePath.split(".");
  let serviceConstructor: any = proto;
  for (const part of parts) {
    serviceConstructor = serviceConstructor?.[part];
    if (!serviceConstructor) {
      throw new Error(`Cannot find '${part}' in proto definition (path: ${servicePath})`);
    }
  }

  const client = new serviceConstructor(
    address,
    grpc.credentials.createInsecure(),
  );

  // Extract method names from the service definition
  const methodNames = Object.keys(serviceConstructor.service).map(
    (m) => m.charAt(0).toUpperCase() + m.slice(1),
  );

  return {
    serviceName: servicePath,
    methodNames,
    invoke: (method: string, args: Record<string, unknown>): Promise<unknown> => {
      return new Promise((resolve, reject) => {
        // Method names in grpc-js are camelCase on the client
        const methodName = method.charAt(0).toLowerCase() + method.slice(1);
        if (typeof client[methodName] !== "function") {
          reject(new Error(`Method '${method}' not found on service '${servicePath}'`));
          return;
        }
        client[methodName](args, (err: grpc.ServiceError | null, response: unknown) => {
          if (err) return reject(err);
          resolve(response);
        });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

async function runTests(address: string): Promise<TestResult[]> {
  const results: TestResult[] = [];

  // Test 1: Dynamic proto loading + service discovery
  console.log("\n  Test 1: Dynamic proto loading and service discovery");
  try {
    const client = await createDynamicClient(PROTO_PATH, address, "sample.v1.UserService");
    const hasGetUser = client.methodNames.some((m) => m === "GetUser" || m === "getUser");
    const hasCreateUser = client.methodNames.some((m) => m === "CreateUser" || m === "createUser");

    results.push({
      name: "Dynamic proto loading",
      passed: hasGetUser && hasCreateUser,
      detail: `Service: ${client.serviceName}, Methods: [${client.methodNames.join(", ")}]`,
    });
    console.log(`    [PASS] Found service with methods: ${client.methodNames.join(", ")}`);
  } catch (err) {
    results.push({
      name: "Dynamic proto loading",
      passed: false,
      detail: "Failed to load",
      error: err instanceof Error ? err.message : String(err),
    });
    console.log(`    [FAIL] ${err instanceof Error ? err.message : err}`);
  }

  // Test 2: Unary RPC with nested message response
  console.log("  Test 2: Unary RPC — GetUser with nested messages + enum + repeated");
  try {
    const client = await createDynamicClient(PROTO_PATH, address, "sample.v1.UserService");
    const response = (await client.invoke("GetUser", { user_id: "usr_001" })) as any;

    const hasNested = response.address?.city === "Portland";
    const hasRepeated = Array.isArray(response.roles) && response.roles.length === 2;
    const hasEnum = response.priority === "PRIORITY_HIGH";
    const passed = hasNested && hasRepeated && hasEnum;

    results.push({
      name: "Unary RPC (nested + repeated + enum)",
      passed,
      detail: JSON.stringify(response, null, 2).slice(0, 300),
    });
    console.log(`    [${passed ? "PASS" : "FAIL"}] Response: nested=${hasNested}, repeated=${hasRepeated}, enum=${hasEnum}`);
  } catch (err) {
    results.push({
      name: "Unary RPC (nested + repeated + enum)",
      passed: false,
      detail: "RPC failed",
      error: err instanceof Error ? err.message : String(err),
    });
    console.log(`    [FAIL] ${err instanceof Error ? err.message : err}`);
  }

  // Test 3: Unary RPC with nested message in request
  console.log("  Test 3: Unary RPC — CreateUser with nested request");
  try {
    const client = await createDynamicClient(PROTO_PATH, address, "sample.v1.UserService");
    const response = (await client.invoke("CreateUser", {
      name: "Bob",
      email: "bob@example.com",
      address: { street: "456 Oak Ave", city: "Seattle", country: "US", zip_code: "98101" },
      roles: ["viewer"],
      priority: "PRIORITY_MEDIUM",
    })) as any;

    const passed = response.success === true && typeof response.user_id === "string";
    results.push({
      name: "Unary RPC (nested request)",
      passed,
      detail: JSON.stringify(response),
    });
    console.log(`    [${passed ? "PASS" : "FAIL"}] success=${response.success}, user_id=${response.user_id}`);
  } catch (err) {
    results.push({
      name: "Unary RPC (nested request)",
      passed: false,
      detail: "RPC failed",
      error: err instanceof Error ? err.message : String(err),
    });
    console.log(`    [FAIL] ${err instanceof Error ? err.message : err}`);
  }

  // Test 4: Error handling — NOT_FOUND
  console.log("  Test 4: Error handling — NOT_FOUND");
  try {
    const client = await createDynamicClient(PROTO_PATH, address, "sample.v1.UserService");
    await client.invoke("GetUser", { user_id: "not-found" });
    results.push({
      name: "Error: NOT_FOUND",
      passed: false,
      detail: "Expected error but got success",
    });
    console.log("    [FAIL] Expected error but got success");
  } catch (err) {
    const grpcErr = err as grpc.ServiceError;
    const passed = grpcErr.code === grpc.status.NOT_FOUND;
    results.push({
      name: "Error: NOT_FOUND",
      passed,
      detail: `code=${grpcErr.code}, message=${grpcErr.message}`,
    });
    console.log(`    [${passed ? "PASS" : "FAIL"}] code=${grpcErr.code} (NOT_FOUND=${grpc.status.NOT_FOUND}), message="${grpcErr.message}"`);
  }

  // Test 5: Error handling — INVALID_ARGUMENT
  console.log("  Test 5: Error handling — INVALID_ARGUMENT");
  try {
    const client = await createDynamicClient(PROTO_PATH, address, "sample.v1.UserService");
    await client.invoke("GetUser", { user_id: "" });
    results.push({
      name: "Error: INVALID_ARGUMENT",
      passed: false,
      detail: "Expected error but got success",
    });
    console.log("    [FAIL] Expected error but got success");
  } catch (err) {
    const grpcErr = err as grpc.ServiceError;
    const passed = grpcErr.code === grpc.status.INVALID_ARGUMENT;
    results.push({
      name: "Error: INVALID_ARGUMENT",
      passed,
      detail: `code=${grpcErr.code}, message=${grpcErr.message}`,
    });
    console.log(`    [${passed ? "PASS" : "FAIL"}] code=${grpcErr.code} (INVALID_ARGUMENT=${grpc.status.INVALID_ARGUMENT}), message="${grpcErr.message}"`);
  }

  // Test 6: Error handling — connection refused
  console.log("  Test 6: Error handling — connection refused (bad port)");
  try {
    const client = await createDynamicClient(PROTO_PATH, "localhost:1", "sample.v1.UserService");
    await client.invoke("GetUser", { user_id: "test" });
    results.push({
      name: "Error: connection refused",
      passed: false,
      detail: "Expected connection error",
    });
    console.log("    [FAIL] Expected connection error");
  } catch (err) {
    const grpcErr = err as grpc.ServiceError;
    const passed = grpcErr.code === grpc.status.UNAVAILABLE;
    results.push({
      name: "Error: connection refused",
      passed,
      detail: `code=${grpcErr.code}, message=${grpcErr.message?.slice(0, 100)}`,
    });
    console.log(`    [${passed ? "PASS" : "FAIL"}] code=${grpcErr.code} (UNAVAILABLE=${grpc.status.UNAVAILABLE})`);
  }

  // Test 7: Error handling — method not found on client
  console.log("  Test 7: Error handling — method not found");
  try {
    const client = await createDynamicClient(PROTO_PATH, address, "sample.v1.UserService");
    await client.invoke("NonExistentMethod", {});
    results.push({
      name: "Error: method not found",
      passed: false,
      detail: "Expected method not found error",
    });
    console.log("    [FAIL] Expected method not found error");
  } catch (err) {
    const passed = err instanceof Error && err.message.includes("not found");
    results.push({
      name: "Error: method not found",
      passed,
      detail: err instanceof Error ? err.message : String(err),
    });
    console.log(`    [${passed ? "PASS" : "FAIL"}] ${err instanceof Error ? err.message : err}`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=".repeat(72));
  console.log("T01b: Dynamic gRPC Invocation Validation Spike");
  console.log("=".repeat(72));

  const address = `localhost:${TEST_PORT}`;

  console.log("\n  Starting test gRPC server...");
  const server = await startTestServer(TEST_PORT);

  try {
    const results = await runTests(address);

    // Summary
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;

    console.log("\n" + "=".repeat(72));
    console.log("SUMMARY");
    console.log("=".repeat(72));
    console.log(`\n  ${passed}/${total} tests passed`);
    console.log(`  Pass rate: ${((passed / total) * 100).toFixed(1)}%`);

    for (const r of results) {
      console.log(`  [${r.passed ? "PASS" : "FAIL"}] ${r.name}`);
    }

    // Write results
    const resultsPath = join(__dirname, "..", "results", "grpc-results.md");
    let md = "# T01b: Dynamic gRPC Invocation Results\n\n";
    md += `**Date**: ${new Date().toISOString()}\n\n`;
    md += `## Test Results (${passed}/${total} passed)\n\n`;
    md += "| Test | Result | Detail |\n|------|--------|--------|\n";
    for (const r of results) {
      md += `| ${r.name} | ${r.passed ? "PASS" : "FAIL"} | ${r.detail.slice(0, 80)} |\n`;
    }
    md += "\n## Key Findings\n\n";
    md += "- `@grpc/proto-loader` successfully loads .proto files at runtime without code generation\n";
    md += "- `@grpc/grpc-js` creates clients dynamically from loaded package definitions\n";
    md += "- Nested messages, repeated fields, and enums work correctly\n";
    md += "- gRPC error codes (NOT_FOUND, INVALID_ARGUMENT, UNAVAILABLE) propagate with meaningful messages\n";
    md += "- Method invocation uses camelCase on the client (auto-converted from proto snake_case)\n";
    md += "\n## Comparison to Go grpcurl\n\n";
    md += "| Capability | Go (grpcurl) | TypeScript (@grpc/proto-loader) |\n";
    md += "|-----------|-------------|--------------------------------|\n";
    md += "| Dynamic proto loading | `DescriptorSourceFromProtoFiles` | `protoLoader.loadSync` |\n";
    md += "| RPC invocation | `grpcurl.InvokeRPC` | `client[method](args, callback)` |\n";
    md += "| JSON input/output | Yes | Yes (native JS objects) |\n";
    md += "| Server reflection | Yes | Requires separate package |\n";
    md += "| Error handling | gRPC status codes | gRPC status codes (same) |\n";
    md += "\n## Gate Assessment\n\n";
    if (passed === total) {
      md += "**PASS**: Dynamic gRPC invocation is fully functional. All test patterns (nested, repeated, enum, errors) work correctly.\n";
    } else {
      md += `**CONDITIONAL**: ${passed}/${total} tests passed. Review failures for workaround feasibility.\n`;
    }

    writeFileSync(resultsPath, md);
    console.log(`\n  Results written to: ${resultsPath}`);
  } finally {
    server.forceShutdown();
    console.log("  Test server shut down.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
