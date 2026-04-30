/**
 * Connect-RPC client for communicating with the Stigmer server.
 *
 * Provides typed wrappers around the generated service stubs for the RPCs
 * the cursor-runner needs: execution queries, status updates, and session
 * reads/writes.
 *
 * Auth: Bearer token from STIGMER_TOKEN, same pattern as the Python
 * agent-runner's channel.py.
 */

import { createClient, type Client, type Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_connect.js";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_connect.js";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_connect.js";
import { SessionQueryController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/query_connect.js";
import type { AgentExecution, AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb.js";
import type { AgentExecutionUpdateStatusInput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb.js";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb.js";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb.js";

export interface StigmerClientOptions {
  endpoint: string;
  token: string;
}

/**
 * Typed client for Stigmer server RPCs used by the cursor-runner.
 *
 * Each method corresponds to a gRPC call the cursor-runner makes during
 * execution. The client handles transport setup and auth header injection.
 */
export class StigmerClient {
  private readonly transport: Transport;
  private readonly executionQuery: Client<typeof AgentExecutionQueryController>;
  private readonly executionCommand: Client<typeof AgentExecutionCommandController>;
  private readonly sessionQuery: Client<typeof SessionQueryController>;
  private readonly sessionCommand: Client<typeof SessionCommandController>;

  constructor(options: StigmerClientOptions) {
    this.transport = createGrpcTransport({
      baseUrl: options.endpoint,
      httpVersion: "2",
      interceptors: [
        (next) => async (req) => {
          req.header.set("authorization", `Bearer ${options.token}`);
          return next(req);
        },
      ],
    });

    this.executionQuery = createClient(AgentExecutionQueryController, this.transport);
    this.executionCommand = createClient(AgentExecutionCommandController, this.transport);
    this.sessionQuery = createClient(SessionQueryController, this.transport);
    this.sessionCommand = createClient(SessionCommandController, this.transport);
  }

  async getExecution(executionId: string): Promise<AgentExecution> {
    return this.executionQuery.get({ value: executionId });
  }

  async updateStatus(
    executionId: string,
    status: AgentExecutionStatus,
  ): Promise<AgentExecution> {
    const input = create(AgentExecutionUpdateStatusInputSchema, {
      id: executionId,
      status,
    });
    return this.executionCommand.updateStatus(input);
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.sessionQuery.get({ value: sessionId });
  }

  async updateSession(session: Session): Promise<Session> {
    return this.sessionCommand.update(session);
  }
}
