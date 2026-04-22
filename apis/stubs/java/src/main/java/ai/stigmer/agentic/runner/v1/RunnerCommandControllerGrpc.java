package ai.stigmer.agentic.runner.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * RunnerCommandController handles write operations for runners.
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
public final class RunnerCommandControllerGrpc {

  private RunnerCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.runner.v1.RunnerCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.runner.v1.Runner.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner> getApplyMethod;
    if ((getApplyMethod = RunnerCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getApplyMethod = RunnerCommandControllerGrpc.getApplyMethod) == null) {
          RunnerCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.runner.v1.Runner.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner> getCreateMethod;
    if ((getCreateMethod = RunnerCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getCreateMethod = RunnerCommandControllerGrpc.getCreateMethod) == null) {
          RunnerCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.runner.v1.Runner.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner,
      ai.stigmer.agentic.runner.v1.Runner> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner> getUpdateMethod;
    if ((getUpdateMethod = RunnerCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getUpdateMethod = RunnerCommandControllerGrpc.getUpdateMethod) == null) {
          RunnerCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.Runner, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerId,
      ai.stigmer.agentic.runner.v1.Runner> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.runner.v1.RunnerId.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerId,
      ai.stigmer.agentic.runner.v1.Runner> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerId, ai.stigmer.agentic.runner.v1.Runner> getDeleteMethod;
    if ((getDeleteMethod = RunnerCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getDeleteMethod = RunnerCommandControllerGrpc.getDeleteMethod) == null) {
          RunnerCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.RunnerId, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput,
      ai.stigmer.agentic.runner.v1.Runner> getHeartbeatMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "heartbeat",
      requestType = ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput.class,
      responseType = ai.stigmer.agentic.runner.v1.Runner.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput,
      ai.stigmer.agentic.runner.v1.Runner> getHeartbeatMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput, ai.stigmer.agentic.runner.v1.Runner> getHeartbeatMethod;
    if ((getHeartbeatMethod = RunnerCommandControllerGrpc.getHeartbeatMethod) == null) {
      synchronized (RunnerCommandControllerGrpc.class) {
        if ((getHeartbeatMethod = RunnerCommandControllerGrpc.getHeartbeatMethod) == null) {
          RunnerCommandControllerGrpc.getHeartbeatMethod = getHeartbeatMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput, ai.stigmer.agentic.runner.v1.Runner>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "heartbeat"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.runner.v1.Runner.getDefaultInstance()))
              .setSchemaDescriptor(new RunnerCommandControllerMethodDescriptorSupplier("heartbeat"))
              .build();
        }
      }
    }
    return getHeartbeatMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static RunnerCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerStub>() {
        @java.lang.Override
        public RunnerCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerCommandControllerStub(channel, callOptions);
        }
      };
    return RunnerCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static RunnerCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public RunnerCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return RunnerCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static RunnerCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerBlockingStub>() {
        @java.lang.Override
        public RunnerCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return RunnerCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static RunnerCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RunnerCommandControllerFutureStub>() {
        @java.lang.Override
        public RunnerCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RunnerCommandControllerFutureStub(channel, callOptions);
        }
      };
    return RunnerCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * RunnerCommandController handles write operations for runners.
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
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    default void create(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    default void update(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.runner.v1.RunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
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
     * Skipped at the interceptor level because the input is RunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    default void heartbeat(ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getHeartbeatMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations for runners.
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
  public static abstract class RunnerCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return RunnerCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations for runners.
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
  public static final class RunnerCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<RunnerCommandControllerStub> {
    private RunnerCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public void create(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    public void update(ai.stigmer.agentic.runner.v1.Runner request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.runner.v1.RunnerId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
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
     * Skipped at the interceptor level because the input is RunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    public void heartbeat(ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getHeartbeatMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations for runners.
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
  public static final class RunnerCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<RunnerCommandControllerBlockingV2Stub> {
    private RunnerCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner apply(ai.stigmer.agentic.runner.v1.Runner request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner create(ai.stigmer.agentic.runner.v1.Runner request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner update(ai.stigmer.agentic.runner.v1.Runner request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner delete(ai.stigmer.agentic.runner.v1.RunnerId request) throws io.grpc.StatusException {
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
     * Skipped at the interceptor level because the input is RunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner heartbeat(ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getHeartbeatMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations for runners.
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
  public static final class RunnerCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<RunnerCommandControllerBlockingStub> {
    private RunnerCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner apply(ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner create(ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner update(ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner delete(ai.stigmer.agentic.runner.v1.RunnerId request) {
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
     * Skipped at the interceptor level because the input is RunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    public ai.stigmer.agentic.runner.v1.Runner heartbeat(ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getHeartbeatMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service RunnerCommandController.
   * <pre>
   * RunnerCommandController handles write operations for runners.
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
  public static final class RunnerCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<RunnerCommandControllerFutureStub> {
    private RunnerCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RunnerCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RunnerCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a runner.
     * &#64;internal
     * Primary registration path for CLI/Desktop runners. The handler determines
     * whether to create or update based on whether the resource already exists
     * (resolved by org + slug). Authorization is handled in the handler.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> apply(
        ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new runner.
     * &#64;internal
     * Authorization: Caller must have can_create_runner permission in the
     * organization. The server generates the task queue name (runner:{id})
     * and sets the initial phase to PENDING.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> create(
        ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing runner.
     * &#64;internal
     * Used for updating spec fields (e.g., description). Status fields are
     * updated via heartbeat, not via this RPC.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> update(
        ai.stigmer.agentic.runner.v1.Runner request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a runner.
     * &#64;internal
     * For persistent runners: removes the resource and its task queue.
     * For system-managed runners: called by the execution workflow during
     * cleanup after the execution completes.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> delete(
        ai.stigmer.agentic.runner.v1.RunnerId request) {
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
     * Skipped at the interceptor level because the input is RunnerHeartbeatInput
     * (not a resource), and the ownership check requires a DB lookup.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.runner.v1.Runner> heartbeat(
        ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput request) {
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
          serviceImpl.apply((ai.stigmer.agentic.runner.v1.Runner) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.runner.v1.Runner) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.runner.v1.Runner) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.runner.v1.RunnerId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
          break;
        case METHODID_HEARTBEAT:
          serviceImpl.heartbeat((ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.runner.v1.Runner>) responseObserver);
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
              ai.stigmer.agentic.runner.v1.Runner,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.Runner,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.Runner,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.RunnerId,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_DELETE)))
        .addMethod(
          getHeartbeatMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.runner.v1.RunnerHeartbeatInput,
              ai.stigmer.agentic.runner.v1.Runner>(
                service, METHODID_HEARTBEAT)))
        .build();
  }

  private static abstract class RunnerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    RunnerCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.runner.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("RunnerCommandController");
    }
  }

  private static final class RunnerCommandControllerFileDescriptorSupplier
      extends RunnerCommandControllerBaseDescriptorSupplier {
    RunnerCommandControllerFileDescriptorSupplier() {}
  }

  private static final class RunnerCommandControllerMethodDescriptorSupplier
      extends RunnerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    RunnerCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (RunnerCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new RunnerCommandControllerFileDescriptorSupplier())
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
