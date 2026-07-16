package ai.stigmer.agentic.agentchannel.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentChannelCommandController handles write operations for agent channels.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentChannelCommandControllerGrpc {

  private AgentChannelCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentchannel.v1.AgentChannelCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannel,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannel,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannel, ai.stigmer.agentic.agentchannel.v1.AgentChannel> getApplyMethod;
    if ((getApplyMethod = AgentChannelCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (AgentChannelCommandControllerGrpc.class) {
        if ((getApplyMethod = AgentChannelCommandControllerGrpc.getApplyMethod) == null) {
          AgentChannelCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.AgentChannel, ai.stigmer.agentic.agentchannel.v1.AgentChannel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannel,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannel,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannel, ai.stigmer.agentic.agentchannel.v1.AgentChannel> getCreateMethod;
    if ((getCreateMethod = AgentChannelCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (AgentChannelCommandControllerGrpc.class) {
        if ((getCreateMethod = AgentChannelCommandControllerGrpc.getCreateMethod) == null) {
          AgentChannelCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.AgentChannel, ai.stigmer.agentic.agentchannel.v1.AgentChannel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannel,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannel,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannel, ai.stigmer.agentic.agentchannel.v1.AgentChannel> getUpdateMethod;
    if ((getUpdateMethod = AgentChannelCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (AgentChannelCommandControllerGrpc.class) {
        if ((getUpdateMethod = AgentChannelCommandControllerGrpc.getUpdateMethod) == null) {
          AgentChannelCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.AgentChannel, ai.stigmer.agentic.agentchannel.v1.AgentChannel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput,
      ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput> getInitiateInstallMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "initiateInstall",
      requestType = ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput,
      ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput> getInitiateInstallMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput, ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput> getInitiateInstallMethod;
    if ((getInitiateInstallMethod = AgentChannelCommandControllerGrpc.getInitiateInstallMethod) == null) {
      synchronized (AgentChannelCommandControllerGrpc.class) {
        if ((getInitiateInstallMethod = AgentChannelCommandControllerGrpc.getInitiateInstallMethod) == null) {
          AgentChannelCommandControllerGrpc.getInitiateInstallMethod = getInitiateInstallMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput, ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "initiateInstall"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelCommandControllerMethodDescriptorSupplier("initiateInstall"))
              .build();
        }
      }
    }
    return getInitiateInstallMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getCompleteInstallMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "completeInstall",
      requestType = ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getCompleteInstallMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput, ai.stigmer.agentic.agentchannel.v1.AgentChannel> getCompleteInstallMethod;
    if ((getCompleteInstallMethod = AgentChannelCommandControllerGrpc.getCompleteInstallMethod) == null) {
      synchronized (AgentChannelCommandControllerGrpc.class) {
        if ((getCompleteInstallMethod = AgentChannelCommandControllerGrpc.getCompleteInstallMethod) == null) {
          AgentChannelCommandControllerGrpc.getCompleteInstallMethod = getCompleteInstallMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput, ai.stigmer.agentic.agentchannel.v1.AgentChannel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "completeInstall"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelCommandControllerMethodDescriptorSupplier("completeInstall"))
              .build();
        }
      }
    }
    return getCompleteInstallMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannelId,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.agentchannel.v1.AgentChannelId.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannelId,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannelId, ai.stigmer.agentic.agentchannel.v1.AgentChannel> getDeleteMethod;
    if ((getDeleteMethod = AgentChannelCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (AgentChannelCommandControllerGrpc.class) {
        if ((getDeleteMethod = AgentChannelCommandControllerGrpc.getDeleteMethod) == null) {
          AgentChannelCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.AgentChannelId, ai.stigmer.agentic.agentchannel.v1.AgentChannel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannelId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentChannelCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentChannelCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentChannelCommandControllerStub>() {
        @java.lang.Override
        public AgentChannelCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentChannelCommandControllerStub(channel, callOptions);
        }
      };
    return AgentChannelCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentChannelCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentChannelCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentChannelCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentChannelCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentChannelCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentChannelCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentChannelCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentChannelCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentChannelCommandControllerBlockingStub>() {
        @java.lang.Override
        public AgentChannelCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentChannelCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentChannelCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentChannelCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentChannelCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentChannelCommandControllerFutureStub>() {
        @java.lang.Override
        public AgentChannelCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentChannelCommandControllerFutureStub(channel, callOptions);
        }
      };
    return AgentChannelCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentChannelCommandController handles write operations for agent channels.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an agent channel.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel is going to be created or updated, resolved as
     * part of request execution. status is preserved verbatim (the install
     * flow is its sole writer).
     * </pre>
     */
    default void apply(ai.stigmer.agentic.agentchannel.v1.AgentChannel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an agent channel.
     * Connecting an agent to a channel is a billing-affecting decision:
     * conversations arriving over the channel consume the connection-owning
     * organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — same bar as AgentShare create,
     * since connecting a channel broadens who can chat with the agent
     * runtime. Standard org-scoped create tuples (owner = creator) for the
     * channel itself; no visibility tuples (channel admission is app-level).
     * Invariant enforced here: metadata.org must equal spec.agent_ref.org.
     * status.install_state is initialized to pending_install.
     * </pre>
     */
    default void create(ai.stigmer.agentic.agentchannel.v1.AgentChannel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent channel.
     * Replaces the spec wholesale. The slug, referenced agent, and provider
     * arm are immutable; status (install facts, credential reference) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent channel.
     * Provider-arm immutability (a slack channel cannot become whatsapp) is
     * enforced in-handler: the install state, credentials, and delivery
     * records are all provider-shaped.
     * </pre>
     */
    default void update(ai.stigmer.agentic.agentchannel.v1.AgentChannel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Start the provider install flow for an agent channel.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — installing
     * grants a workspace access to the agent runtime, the same bar as
     * enabling. Redirect style generates and persists the single-use state
     * (pending-state pattern from MCP OAuth); direct style validates
     * against the provider, persists the status, and maps the
     * duplicate-number refusal (the completeInstall duplicate-workspace
     * mechanism). Cloud-first runtime: the OSS edition stores channel
     * resources but returns FAILED_PRECONDITION here (documented posture,
     * decision 001 D-g / T02 §0-b).
     * </pre>
     */
    default void initiateInstall(ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getInitiateInstallMethod(), responseObserver);
    }

    /**
     * <pre>
     * Complete the provider install flow for an agent channel.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled).
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason — their message is the interface.
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — the same bar
     * as initiateInstall (the two halves of one flow). The handler consumes
     * the state atomically, exchanges the code, stores credentials in the
     * system-managed Environment, records the grant, and writes the status
     * facts (sole writer). The OSS edition returns FAILED_PRECONDITION
     * (documented posture, decision 001 D-g / T02 §0-b).
     * </pre>
     */
    default void completeInstall(ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCompleteInstallMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an agent channel.
     * Full teardown of the connection: inbound events for the workspace stop
     * resolving, pending deliveries are abandoned, and the credentials
     * environment is deleted with the grant. To pause serving while keeping
     * the install, update the channel with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent channel.
     * The referenced agent is untouched. Teardown cascade (managed env +
     * grant deletion) mirrors McpServer disconnectOAuth.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.agentchannel.v1.AgentChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentChannelCommandController.
   * <pre>
   * AgentChannelCommandController handles write operations for agent channels.
   * </pre>
   */
  public static abstract class AgentChannelCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentChannelCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentChannelCommandController.
   * <pre>
   * AgentChannelCommandController handles write operations for agent channels.
   * </pre>
   */
  public static final class AgentChannelCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentChannelCommandControllerStub> {
    private AgentChannelCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentChannelCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentChannelCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent channel.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel is going to be created or updated, resolved as
     * part of request execution. status is preserved verbatim (the install
     * flow is its sole writer).
     * </pre>
     */
    public void apply(ai.stigmer.agentic.agentchannel.v1.AgentChannel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an agent channel.
     * Connecting an agent to a channel is a billing-affecting decision:
     * conversations arriving over the channel consume the connection-owning
     * organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — same bar as AgentShare create,
     * since connecting a channel broadens who can chat with the agent
     * runtime. Standard org-scoped create tuples (owner = creator) for the
     * channel itself; no visibility tuples (channel admission is app-level).
     * Invariant enforced here: metadata.org must equal spec.agent_ref.org.
     * status.install_state is initialized to pending_install.
     * </pre>
     */
    public void create(ai.stigmer.agentic.agentchannel.v1.AgentChannel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent channel.
     * Replaces the spec wholesale. The slug, referenced agent, and provider
     * arm are immutable; status (install facts, credential reference) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent channel.
     * Provider-arm immutability (a slack channel cannot become whatsapp) is
     * enforced in-handler: the install state, credentials, and delivery
     * records are all provider-shaped.
     * </pre>
     */
    public void update(ai.stigmer.agentic.agentchannel.v1.AgentChannel request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Start the provider install flow for an agent channel.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — installing
     * grants a workspace access to the agent runtime, the same bar as
     * enabling. Redirect style generates and persists the single-use state
     * (pending-state pattern from MCP OAuth); direct style validates
     * against the provider, persists the status, and maps the
     * duplicate-number refusal (the completeInstall duplicate-workspace
     * mechanism). Cloud-first runtime: the OSS edition stores channel
     * resources but returns FAILED_PRECONDITION here (documented posture,
     * decision 001 D-g / T02 §0-b).
     * </pre>
     */
    public void initiateInstall(ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getInitiateInstallMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Complete the provider install flow for an agent channel.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled).
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason — their message is the interface.
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — the same bar
     * as initiateInstall (the two halves of one flow). The handler consumes
     * the state atomically, exchanges the code, stores credentials in the
     * system-managed Environment, records the grant, and writes the status
     * facts (sole writer). The OSS edition returns FAILED_PRECONDITION
     * (documented posture, decision 001 D-g / T02 §0-b).
     * </pre>
     */
    public void completeInstall(ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCompleteInstallMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an agent channel.
     * Full teardown of the connection: inbound events for the workspace stop
     * resolving, pending deliveries are abandoned, and the credentials
     * environment is deleted with the grant. To pause serving while keeping
     * the install, update the channel with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent channel.
     * The referenced agent is untouched. Teardown cascade (managed env +
     * grant deletion) mirrors McpServer disconnectOAuth.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.agentchannel.v1.AgentChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentChannelCommandController.
   * <pre>
   * AgentChannelCommandController handles write operations for agent channels.
   * </pre>
   */
  public static final class AgentChannelCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentChannelCommandControllerBlockingV2Stub> {
    private AgentChannelCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentChannelCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentChannelCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent channel.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel is going to be created or updated, resolved as
     * part of request execution. status is preserved verbatim (the install
     * flow is its sole writer).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel apply(ai.stigmer.agentic.agentchannel.v1.AgentChannel request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent channel.
     * Connecting an agent to a channel is a billing-affecting decision:
     * conversations arriving over the channel consume the connection-owning
     * organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — same bar as AgentShare create,
     * since connecting a channel broadens who can chat with the agent
     * runtime. Standard org-scoped create tuples (owner = creator) for the
     * channel itself; no visibility tuples (channel admission is app-level).
     * Invariant enforced here: metadata.org must equal spec.agent_ref.org.
     * status.install_state is initialized to pending_install.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel create(ai.stigmer.agentic.agentchannel.v1.AgentChannel request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent channel.
     * Replaces the spec wholesale. The slug, referenced agent, and provider
     * arm are immutable; status (install facts, credential reference) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent channel.
     * Provider-arm immutability (a slack channel cannot become whatsapp) is
     * enforced in-handler: the install state, credentials, and delivery
     * records are all provider-shaped.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel update(ai.stigmer.agentic.agentchannel.v1.AgentChannel request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start the provider install flow for an agent channel.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — installing
     * grants a workspace access to the agent runtime, the same bar as
     * enabling. Redirect style generates and persists the single-use state
     * (pending-state pattern from MCP OAuth); direct style validates
     * against the provider, persists the status, and maps the
     * duplicate-number refusal (the completeInstall duplicate-workspace
     * mechanism). Cloud-first runtime: the OSS edition stores channel
     * resources but returns FAILED_PRECONDITION here (documented posture,
     * decision 001 D-g / T02 §0-b).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput initiateInstall(ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getInitiateInstallMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Complete the provider install flow for an agent channel.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled).
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason — their message is the interface.
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — the same bar
     * as initiateInstall (the two halves of one flow). The handler consumes
     * the state atomically, exchanges the code, stores credentials in the
     * system-managed Environment, records the grant, and writes the status
     * facts (sole writer). The OSS edition returns FAILED_PRECONDITION
     * (documented posture, decision 001 D-g / T02 §0-b).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel completeInstall(ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCompleteInstallMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent channel.
     * Full teardown of the connection: inbound events for the workspace stop
     * resolving, pending deliveries are abandoned, and the credentials
     * environment is deleted with the grant. To pause serving while keeping
     * the install, update the channel with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent channel.
     * The referenced agent is untouched. Teardown cascade (managed env +
     * grant deletion) mirrors McpServer disconnectOAuth.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel delete(ai.stigmer.agentic.agentchannel.v1.AgentChannelId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentChannelCommandController.
   * <pre>
   * AgentChannelCommandController handles write operations for agent channels.
   * </pre>
   */
  public static final class AgentChannelCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentChannelCommandControllerBlockingStub> {
    private AgentChannelCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentChannelCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentChannelCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent channel.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel is going to be created or updated, resolved as
     * part of request execution. status is preserved verbatim (the install
     * flow is its sole writer).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel apply(ai.stigmer.agentic.agentchannel.v1.AgentChannel request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent channel.
     * Connecting an agent to a channel is a billing-affecting decision:
     * conversations arriving over the channel consume the connection-owning
     * organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — same bar as AgentShare create,
     * since connecting a channel broadens who can chat with the agent
     * runtime. Standard org-scoped create tuples (owner = creator) for the
     * channel itself; no visibility tuples (channel admission is app-level).
     * Invariant enforced here: metadata.org must equal spec.agent_ref.org.
     * status.install_state is initialized to pending_install.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel create(ai.stigmer.agentic.agentchannel.v1.AgentChannel request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent channel.
     * Replaces the spec wholesale. The slug, referenced agent, and provider
     * arm are immutable; status (install facts, credential reference) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent channel.
     * Provider-arm immutability (a slack channel cannot become whatsapp) is
     * enforced in-handler: the install state, credentials, and delivery
     * records are all provider-shaped.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel update(ai.stigmer.agentic.agentchannel.v1.AgentChannel request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start the provider install flow for an agent channel.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — installing
     * grants a workspace access to the agent runtime, the same bar as
     * enabling. Redirect style generates and persists the single-use state
     * (pending-state pattern from MCP OAuth); direct style validates
     * against the provider, persists the status, and maps the
     * duplicate-number refusal (the completeInstall duplicate-workspace
     * mechanism). Cloud-first runtime: the OSS edition stores channel
     * resources but returns FAILED_PRECONDITION here (documented posture,
     * decision 001 D-g / T02 §0-b).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput initiateInstall(ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getInitiateInstallMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Complete the provider install flow for an agent channel.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled).
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason — their message is the interface.
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — the same bar
     * as initiateInstall (the two halves of one flow). The handler consumes
     * the state atomically, exchanges the code, stores credentials in the
     * system-managed Environment, records the grant, and writes the status
     * facts (sole writer). The OSS edition returns FAILED_PRECONDITION
     * (documented posture, decision 001 D-g / T02 §0-b).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel completeInstall(ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCompleteInstallMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent channel.
     * Full teardown of the connection: inbound events for the workspace stop
     * resolving, pending deliveries are abandoned, and the credentials
     * environment is deleted with the grant. To pause serving while keeping
     * the install, update the channel with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent channel.
     * The referenced agent is untouched. Teardown cascade (managed env +
     * grant deletion) mirrors McpServer disconnectOAuth.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel delete(ai.stigmer.agentic.agentchannel.v1.AgentChannelId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentChannelCommandController.
   * <pre>
   * AgentChannelCommandController handles write operations for agent channels.
   * </pre>
   */
  public static final class AgentChannelCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentChannelCommandControllerFutureStub> {
    private AgentChannelCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentChannelCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentChannelCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent channel.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel is going to be created or updated, resolved as
     * part of request execution. status is preserved verbatim (the install
     * flow is its sole writer).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.AgentChannel> apply(
        ai.stigmer.agentic.agentchannel.v1.AgentChannel request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an agent channel.
     * Connecting an agent to a channel is a billing-affecting decision:
     * conversations arriving over the channel consume the connection-owning
     * organization's credits.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent_ref), checked in-handler — same bar as AgentShare create,
     * since connecting a channel broadens who can chat with the agent
     * runtime. Standard org-scoped create tuples (owner = creator) for the
     * channel itself; no visibility tuples (channel admission is app-level).
     * Invariant enforced here: metadata.org must equal spec.agent_ref.org.
     * status.install_state is initialized to pending_install.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.AgentChannel> create(
        ai.stigmer.agentic.agentchannel.v1.AgentChannel request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing agent channel.
     * Replaces the spec wholesale. The slug, referenced agent, and provider
     * arm are immutable; status (install facts, credential reference) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the agent channel.
     * Provider-arm immutability (a slack channel cannot become whatsapp) is
     * enforced in-handler: the install state, credentials, and delivery
     * records are all provider-shaped.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.AgentChannel> update(
        ai.stigmer.agentic.agentchannel.v1.AgentChannel request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Start the provider install flow for an agent channel.
     * For redirect-installed providers (Slack) the output carries the
     * provider authorization URL to redirect the installing user to, plus
     * the single-use state that completeInstall verifies. For
     * direct-installed providers (WhatsApp) the install runs to completion
     * inside this RPC and the output carries completed=true instead.
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - WHATSAPP_NUMBER_ALREADY_CONNECTED — the WhatsApp Business number
     *     already serves an agent through this channel app (one agent per
     *     number per app). Metadata: display_phone_number (the occupied
     *     number), channel_app_id (the serving app).
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — installing
     * grants a workspace access to the agent runtime, the same bar as
     * enabling. Redirect style generates and persists the single-use state
     * (pending-state pattern from MCP OAuth); direct style validates
     * against the provider, persists the status, and maps the
     * duplicate-number refusal (the completeInstall duplicate-workspace
     * mechanism). Cloud-first runtime: the OSS edition stores channel
     * resources but returns FAILED_PRECONDITION here (documented posture,
     * decision 001 D-g / T02 §0-b).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput> initiateInstall(
        ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getInitiateInstallMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Complete the provider install flow for an agent channel.
     * Called by the console after the provider's consent redirect, with the
     * state from initiateInstall and the provider's authorization code. On
     * success the channel's status carries the install facts and the
     * channel begins serving (subject to spec.enabled).
     * Refusals a client should branch on carry a google.rpc.ErrorInfo
     * detail (domain "stigmer.ai") on the standard grpc-status-details-bin
     * trailer, alongside the human-readable FAILED_PRECONDITION message:
     *   - SLACK_WORKSPACE_ALREADY_CONNECTED — the workspace already hosts
     *     an agent through this serving app (one agent per workspace per
     *     app). Metadata: team_name (the occupied workspace),
     *     channel_app_id (the serving app; empty = platform app).
     *   - CHANNEL_INSTALL_STATE_INVALID — the state parameter is missing,
     *     expired, or replayed; restart the install.
     *   - SLACK_ENTERPRISE_INSTALL_UNSUPPORTED — an Enterprise Grid
     *     org-wide install was attempted; install into a single workspace.
     * Other refusals (unconfigured deployment, provider-refused code
     * exchange) carry no reason — their message is the interface.
     * &#64;internal
     * Authorization: requires can_edit on the agent channel — the same bar
     * as initiateInstall (the two halves of one flow). The handler consumes
     * the state atomically, exchanges the code, stores credentials in the
     * system-managed Environment, records the grant, and writes the status
     * facts (sole writer). The OSS edition returns FAILED_PRECONDITION
     * (documented posture, decision 001 D-g / T02 §0-b).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.AgentChannel> completeInstall(
        ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCompleteInstallMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an agent channel.
     * Full teardown of the connection: inbound events for the workspace stop
     * resolving, pending deliveries are abandoned, and the credentials
     * environment is deleted with the grant. To pause serving while keeping
     * the install, update the channel with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the agent channel.
     * The referenced agent is untouched. Teardown cascade (managed env +
     * grant deletion) mirrors McpServer disconnectOAuth.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.AgentChannel> delete(
        ai.stigmer.agentic.agentchannel.v1.AgentChannelId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_INITIATE_INSTALL = 3;
  private static final int METHODID_COMPLETE_INSTALL = 4;
  private static final int METHODID_DELETE = 5;

  private static final class MethodHandlers<Req, Resp> implements
      io.grpc.stub.ServerCalls.UnaryMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ServerStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ClientStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.BidiStreamingMethod<Req, Resp> {
    private final AsyncService serviceImpl;
    private final int methodId;

    MethodHandlers(AsyncService serviceImpl, int methodId) {
      this.serviceImpl = serviceImpl;
      this.methodId = methodId;
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public void invoke(Req request, io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        case METHODID_APPLY:
          serviceImpl.apply((ai.stigmer.agentic.agentchannel.v1.AgentChannel) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.agentchannel.v1.AgentChannel) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.agentchannel.v1.AgentChannel) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel>) responseObserver);
          break;
        case METHODID_INITIATE_INSTALL:
          serviceImpl.initiateInstall((ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput>) responseObserver);
          break;
        case METHODID_COMPLETE_INSTALL:
          serviceImpl.completeInstall((ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.agentchannel.v1.AgentChannelId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel>) responseObserver);
          break;
        default:
          throw new AssertionError();
      }
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public io.grpc.stub.StreamObserver<Req> invoke(
        io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        default:
          throw new AssertionError();
      }
    }
  }

  public static final io.grpc.ServerServiceDefinition bindService(AsyncService service) {
    return io.grpc.ServerServiceDefinition.builder(getServiceDescriptor())
        .addMethod(
          getApplyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.AgentChannel,
              ai.stigmer.agentic.agentchannel.v1.AgentChannel>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.AgentChannel,
              ai.stigmer.agentic.agentchannel.v1.AgentChannel>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.AgentChannel,
              ai.stigmer.agentic.agentchannel.v1.AgentChannel>(
                service, METHODID_UPDATE)))
        .addMethod(
          getInitiateInstallMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallInput,
              ai.stigmer.agentic.agentchannel.v1.InitiateChannelInstallOutput>(
                service, METHODID_INITIATE_INSTALL)))
        .addMethod(
          getCompleteInstallMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.CompleteChannelInstallInput,
              ai.stigmer.agentic.agentchannel.v1.AgentChannel>(
                service, METHODID_COMPLETE_INSTALL)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.AgentChannelId,
              ai.stigmer.agentic.agentchannel.v1.AgentChannel>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class AgentChannelCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentChannelCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentchannel.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentChannelCommandController");
    }
  }

  private static final class AgentChannelCommandControllerFileDescriptorSupplier
      extends AgentChannelCommandControllerBaseDescriptorSupplier {
    AgentChannelCommandControllerFileDescriptorSupplier() {}
  }

  private static final class AgentChannelCommandControllerMethodDescriptorSupplier
      extends AgentChannelCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentChannelCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
      this.methodName = methodName;
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.MethodDescriptor getMethodDescriptor() {
      return getServiceDescriptor().findMethodByName(methodName);
    }
  }

  private static volatile io.grpc.ServiceDescriptor serviceDescriptor;

  public static io.grpc.ServiceDescriptor getServiceDescriptor() {
    io.grpc.ServiceDescriptor result = serviceDescriptor;
    if (result == null) {
      synchronized (AgentChannelCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentChannelCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getInitiateInstallMethod())
              .addMethod(getCompleteInstallMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
