package ai.stigmer.agentic.agentrunner.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentRunnerCommandController handles write operations for agent runners.
 * Two creation patterns are supported:
 * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
 *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
 *    If not, it creates. This is the primary registration path.
 * 2. **Platform (ephemeral runners)**: The execution workflow calls create
 *    with metadata label stigmer.ai/system-managed: "true". The runner is
 *    torn down via delete when the execution completes.
 * The heartbeat RPC is called by the runner process on a regular interval
 * (default 30s) to report liveness and state. It is the runner's only
 * ongoing communication channel with the server.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentRunnerCommandControllerGrpc {

  private AgentRunnerCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentrunner.v1.AgentRunnerCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunner,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      responseType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunner,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunner, ai.stigmer.agentic.agentrunner.v1.AgentRunner> getApplyMethod;
    if ((getApplyMethod = AgentRunnerCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (AgentRunnerCommandControllerGrpc.class) {
        if ((getApplyMethod = AgentRunnerCommandControllerGrpc.getApplyMethod) == null) {
          AgentRunnerCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrunner.v1.AgentRunner, ai.stigmer.agentic.agentrunner.v1.AgentRunner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunnerCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunner,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      responseType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunner,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunner, ai.stigmer.agentic.agentrunner.v1.AgentRunner> getCreateMethod;
    if ((getCreateMethod = AgentRunnerCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (AgentRunnerCommandControllerGrpc.class) {
        if ((getCreateMethod = AgentRunnerCommandControllerGrpc.getCreateMethod) == null) {
          AgentRunnerCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrunner.v1.AgentRunner, ai.stigmer.agentic.agentrunner.v1.AgentRunner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunnerCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunner,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      responseType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunner,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunner, ai.stigmer.agentic.agentrunner.v1.AgentRunner> getUpdateMethod;
    if ((getUpdateMethod = AgentRunnerCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (AgentRunnerCommandControllerGrpc.class) {
        if ((getUpdateMethod = AgentRunnerCommandControllerGrpc.getUpdateMethod) == null) {
          AgentRunnerCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrunner.v1.AgentRunner, ai.stigmer.agentic.agentrunner.v1.AgentRunner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunnerCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunnerId,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.agentrunner.v1.AgentRunnerId.class,
      responseType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunnerId,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunnerId, ai.stigmer.agentic.agentrunner.v1.AgentRunner> getDeleteMethod;
    if ((getDeleteMethod = AgentRunnerCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (AgentRunnerCommandControllerGrpc.class) {
        if ((getDeleteMethod = AgentRunnerCommandControllerGrpc.getDeleteMethod) == null) {
          AgentRunnerCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrunner.v1.AgentRunnerId, ai.stigmer.agentic.agentrunner.v1.AgentRunner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunnerId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunnerCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getHeartbeatMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "heartbeat",
      requestType = ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput.class,
      responseType = ai.stigmer.agentic.agentrunner.v1.AgentRunner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput,
      ai.stigmer.agentic.agentrunner.v1.AgentRunner> getHeartbeatMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput, ai.stigmer.agentic.agentrunner.v1.AgentRunner> getHeartbeatMethod;
    if ((getHeartbeatMethod = AgentRunnerCommandControllerGrpc.getHeartbeatMethod) == null) {
      synchronized (AgentRunnerCommandControllerGrpc.class) {
        if ((getHeartbeatMethod = AgentRunnerCommandControllerGrpc.getHeartbeatMethod) == null) {
          AgentRunnerCommandControllerGrpc.getHeartbeatMethod = getHeartbeatMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput, ai.stigmer.agentic.agentrunner.v1.AgentRunner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "heartbeat"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentrunner.v1.AgentRunner.getDefaultInstance()))
              .setSchemaDescriptor(new AgentRunnerCommandControllerMethodDescriptorSupplier("heartbeat"))
              .build();
        }
      }
    }
    return getHeartbeatMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentRunnerCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunnerCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunnerCommandControllerStub>() {
        @java.lang.Override
        public AgentRunnerCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunnerCommandControllerStub(channel, callOptions);
        }
      };
    return AgentRunnerCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentRunnerCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunnerCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunnerCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentRunnerCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunnerCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentRunnerCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentRunnerCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunnerCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunnerCommandControllerBlockingStub>() {
        @java.lang.Override
        public AgentRunnerCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunnerCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentRunnerCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentRunnerCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentRunnerCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentRunnerCommandControllerFutureStub>() {
        @java.lang.Override
        public AgentRunnerCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentRunnerCommandControllerFutureStub(channel, callOptions);
        }
      };
    return AgentRunnerCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentRunnerCommandController handles write operations for agent runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * The heartbeat RPC is called by the runner process on a regular interval
   * (default 30s) to report liveness and state. It is the runner's only
   * ongoing communication channel with the server.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an agent runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.agentrunner.v1.AgentRunner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new agent runner.
     * &#64;internal
     * Authorization: Caller must have can_create_agent_runner permission in the
     * organization. The server generates the task queue name (agent-runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    default void create(ai.stigmer.agentic.agentrunner.v1.AgentRunner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    default void update(ai.stigmer.agentic.agentrunner.v1.AgentRunner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an agent runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Report runner liveness and operational state.
     * Called by the runner process every 30 seconds. Updates status fields
     * (phase, last_heartbeat_at, current_executions, connection_info) without
     * modifying spec or metadata.
     * If the runner is in PENDING or STOPPED phase, a heartbeat transitions it
     * to the phase reported in the input (typically READY). This enables the
     * "restart and reconnect" flow: a stopped runner resumes heartbeating and
     * goes back to READY with the same identity and task queue.
     * &#64;internal
     * Authorization is handled in the handler: the caller must own the runner.
     * Skipped at the interceptor level because the input is AgentRunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    default void heartbeat(ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getHeartbeatMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentRunnerCommandController.
   * <pre>
   * AgentRunnerCommandController handles write operations for agent runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * The heartbeat RPC is called by the runner process on a regular interval
   * (default 30s) to report liveness and state. It is the runner's only
   * ongoing communication channel with the server.
   * </pre>
   */
  public static abstract class AgentRunnerCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentRunnerCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentRunnerCommandController.
   * <pre>
   * AgentRunnerCommandController handles write operations for agent runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * The heartbeat RPC is called by the runner process on a regular interval
   * (default 30s) to report liveness and state. It is the runner's only
   * ongoing communication channel with the server.
   * </pre>
   */
  public static final class AgentRunnerCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentRunnerCommandControllerStub> {
    private AgentRunnerCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunnerCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunnerCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.agentrunner.v1.AgentRunner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new agent runner.
     * &#64;internal
     * Authorization: Caller must have can_create_agent_runner permission in the
     * organization. The server generates the task queue name (agent-runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public void create(ai.stigmer.agentic.agentrunner.v1.AgentRunner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    public void update(ai.stigmer.agentic.agentrunner.v1.AgentRunner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an agent runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Report runner liveness and operational state.
     * Called by the runner process every 30 seconds. Updates status fields
     * (phase, last_heartbeat_at, current_executions, connection_info) without
     * modifying spec or metadata.
     * If the runner is in PENDING or STOPPED phase, a heartbeat transitions it
     * to the phase reported in the input (typically READY). This enables the
     * "restart and reconnect" flow: a stopped runner resumes heartbeating and
     * goes back to READY with the same identity and task queue.
     * &#64;internal
     * Authorization is handled in the handler: the caller must own the runner.
     * Skipped at the interceptor level because the input is AgentRunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    public void heartbeat(ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getHeartbeatMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentRunnerCommandController.
   * <pre>
   * AgentRunnerCommandController handles write operations for agent runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * The heartbeat RPC is called by the runner process on a regular interval
   * (default 30s) to report liveness and state. It is the runner's only
   * ongoing communication channel with the server.
   * </pre>
   */
  public static final class AgentRunnerCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentRunnerCommandControllerBlockingV2Stub> {
    private AgentRunnerCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunnerCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunnerCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner apply(ai.stigmer.agentic.agentrunner.v1.AgentRunner request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new agent runner.
     * &#64;internal
     * Authorization: Caller must have can_create_agent_runner permission in the
     * organization. The server generates the task queue name (agent-runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner create(ai.stigmer.agentic.agentrunner.v1.AgentRunner request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner update(ai.stigmer.agentic.agentrunner.v1.AgentRunner request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner delete(ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Report runner liveness and operational state.
     * Called by the runner process every 30 seconds. Updates status fields
     * (phase, last_heartbeat_at, current_executions, connection_info) without
     * modifying spec or metadata.
     * If the runner is in PENDING or STOPPED phase, a heartbeat transitions it
     * to the phase reported in the input (typically READY). This enables the
     * "restart and reconnect" flow: a stopped runner resumes heartbeating and
     * goes back to READY with the same identity and task queue.
     * &#64;internal
     * Authorization is handled in the handler: the caller must own the runner.
     * Skipped at the interceptor level because the input is AgentRunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner heartbeat(ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getHeartbeatMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentRunnerCommandController.
   * <pre>
   * AgentRunnerCommandController handles write operations for agent runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * The heartbeat RPC is called by the runner process on a regular interval
   * (default 30s) to report liveness and state. It is the runner's only
   * ongoing communication channel with the server.
   * </pre>
   */
  public static final class AgentRunnerCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentRunnerCommandControllerBlockingStub> {
    private AgentRunnerCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunnerCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunnerCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner apply(ai.stigmer.agentic.agentrunner.v1.AgentRunner request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new agent runner.
     * &#64;internal
     * Authorization: Caller must have can_create_agent_runner permission in the
     * organization. The server generates the task queue name (agent-runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner create(ai.stigmer.agentic.agentrunner.v1.AgentRunner request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner update(ai.stigmer.agentic.agentrunner.v1.AgentRunner request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner delete(ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Report runner liveness and operational state.
     * Called by the runner process every 30 seconds. Updates status fields
     * (phase, last_heartbeat_at, current_executions, connection_info) without
     * modifying spec or metadata.
     * If the runner is in PENDING or STOPPED phase, a heartbeat transitions it
     * to the phase reported in the input (typically READY). This enables the
     * "restart and reconnect" flow: a stopped runner resumes heartbeating and
     * goes back to READY with the same identity and task queue.
     * &#64;internal
     * Authorization is handled in the handler: the caller must own the runner.
     * Skipped at the interceptor level because the input is AgentRunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    public ai.stigmer.agentic.agentrunner.v1.AgentRunner heartbeat(ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getHeartbeatMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentRunnerCommandController.
   * <pre>
   * AgentRunnerCommandController handles write operations for agent runners.
   * Two creation patterns are supported:
   * 1. **CLI/Desktop (persistent runners)**: The client calls apply with a slug
   *    stored in ~/.stigmer/runner.json. If the runner exists, it reactivates.
   *    If not, it creates. This is the primary registration path.
   * 2. **Platform (ephemeral runners)**: The execution workflow calls create
   *    with metadata label stigmer.ai/system-managed: "true". The runner is
   *    torn down via delete when the execution completes.
   * The heartbeat RPC is called by the runner process on a regular interval
   * (default 30s) to report liveness and state. It is the runner's only
   * ongoing communication channel with the server.
   * </pre>
   */
  public static final class AgentRunnerCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentRunnerCommandControllerFutureStub> {
    private AgentRunnerCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentRunnerCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentRunnerCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrunner.v1.AgentRunner> apply(
        ai.stigmer.agentic.agentrunner.v1.AgentRunner request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new agent runner.
     * &#64;internal
     * Authorization: Caller must have can_create_agent_runner permission in the
     * organization. The server generates the task queue name (agent-runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrunner.v1.AgentRunner> create(
        ai.stigmer.agentic.agentrunner.v1.AgentRunner request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing agent runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrunner.v1.AgentRunner> update(
        ai.stigmer.agentic.agentrunner.v1.AgentRunner request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an agent runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrunner.v1.AgentRunner> delete(
        ai.stigmer.agentic.agentrunner.v1.AgentRunnerId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Report runner liveness and operational state.
     * Called by the runner process every 30 seconds. Updates status fields
     * (phase, last_heartbeat_at, current_executions, connection_info) without
     * modifying spec or metadata.
     * If the runner is in PENDING or STOPPED phase, a heartbeat transitions it
     * to the phase reported in the input (typically READY). This enables the
     * "restart and reconnect" flow: a stopped runner resumes heartbeating and
     * goes back to READY with the same identity and task queue.
     * &#64;internal
     * Authorization is handled in the handler: the caller must own the runner.
     * Skipped at the interceptor level because the input is AgentRunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentrunner.v1.AgentRunner> heartbeat(
        ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getHeartbeatMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;
  private static final int METHODID_HEARTBEAT = 4;

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
          serviceImpl.apply((ai.stigmer.agentic.agentrunner.v1.AgentRunner) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.agentrunner.v1.AgentRunner) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.agentrunner.v1.AgentRunner) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.agentrunner.v1.AgentRunnerId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner>) responseObserver);
          break;
        case METHODID_HEARTBEAT:
          serviceImpl.heartbeat((ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentrunner.v1.AgentRunner>) responseObserver);
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
              ai.stigmer.agentic.agentrunner.v1.AgentRunner,
              ai.stigmer.agentic.agentrunner.v1.AgentRunner>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrunner.v1.AgentRunner,
              ai.stigmer.agentic.agentrunner.v1.AgentRunner>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrunner.v1.AgentRunner,
              ai.stigmer.agentic.agentrunner.v1.AgentRunner>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrunner.v1.AgentRunnerId,
              ai.stigmer.agentic.agentrunner.v1.AgentRunner>(
                service, METHODID_DELETE)))
        .addMethod(
          getHeartbeatMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentrunner.v1.AgentRunnerHeartbeatInput,
              ai.stigmer.agentic.agentrunner.v1.AgentRunner>(
                service, METHODID_HEARTBEAT)))
        .build();
  }

  private static abstract class AgentRunnerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentRunnerCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentrunner.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentRunnerCommandController");
    }
  }

  private static final class AgentRunnerCommandControllerFileDescriptorSupplier
      extends AgentRunnerCommandControllerBaseDescriptorSupplier {
    AgentRunnerCommandControllerFileDescriptorSupplier() {}
  }

  private static final class AgentRunnerCommandControllerMethodDescriptorSupplier
      extends AgentRunnerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentRunnerCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentRunnerCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentRunnerCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getHeartbeatMethod())
              .build();
        }
      }
    }
    return result;
  }
}
