package ai.stigmer.agentic.executioncontext.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ExecutionContextCommandController handles write operations for ExecutionContext resources.
 * &#64;internal
 * Every write RPC uses is_skip_authorization with a real handler-level check
 * (the framework's declarative FGA options cannot express any of these):
 *   - create: the caller-class differs by transport. Internal in-process
 *     pipeline calls (agent execution, workflow execution, workflow recovery,
 *     MCP connect) are trusted — the parent operation already authorized the
 *     run against its session-or-org, and the EC is created before that parent
 *     is persisted, so it carries no resource to re-check. External callers
 *     must hold can_create_execution_in on metadata.org (the same bar that
 *     gates creating an execution in the org; held by members and guests).
 *     A declarative org option cannot encode the internal/external split.
 *   - apply: intentionally unannotated router — it delegates to create
 *     (create-or-fail; ExecutionContext has no update RPC) and the delegated
 *     pipeline runs under create's handler, authorization included.
 *   - delete: caller must have can_edit on execution_context:&lt;id&gt; (owner-only,
 *     per the execution_context FGA model). The FGA target is the loaded
 *     resource, so it cannot be a declarative method option.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ExecutionContextCommandControllerGrpc {

  private ExecutionContextCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.executioncontext.v1.ExecutionContextCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContext,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.executioncontext.v1.ExecutionContext.class,
      responseType = ai.stigmer.agentic.executioncontext.v1.ExecutionContext.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContext,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContext, ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getApplyMethod;
    if ((getApplyMethod = ExecutionContextCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (ExecutionContextCommandControllerGrpc.class) {
        if ((getApplyMethod = ExecutionContextCommandControllerGrpc.getApplyMethod) == null) {
          ExecutionContextCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.executioncontext.v1.ExecutionContext, ai.stigmer.agentic.executioncontext.v1.ExecutionContext>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContext.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContext.getDefaultInstance()))
              .setSchemaDescriptor(new ExecutionContextCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContext,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.executioncontext.v1.ExecutionContext.class,
      responseType = ai.stigmer.agentic.executioncontext.v1.ExecutionContext.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContext,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContext, ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getCreateMethod;
    if ((getCreateMethod = ExecutionContextCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (ExecutionContextCommandControllerGrpc.class) {
        if ((getCreateMethod = ExecutionContextCommandControllerGrpc.getCreateMethod) == null) {
          ExecutionContextCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.executioncontext.v1.ExecutionContext, ai.stigmer.agentic.executioncontext.v1.ExecutionContext>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContext.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContext.getDefaultInstance()))
              .setSchemaDescriptor(new ExecutionContextCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.agentic.executioncontext.v1.ExecutionContext.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getDeleteMethod;
    if ((getDeleteMethod = ExecutionContextCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ExecutionContextCommandControllerGrpc.class) {
        if ((getDeleteMethod = ExecutionContextCommandControllerGrpc.getDeleteMethod) == null) {
          ExecutionContextCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.executioncontext.v1.ExecutionContext>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContext.getDefaultInstance()))
              .setSchemaDescriptor(new ExecutionContextCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ExecutionContextCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ExecutionContextCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ExecutionContextCommandControllerStub>() {
        @java.lang.Override
        public ExecutionContextCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ExecutionContextCommandControllerStub(channel, callOptions);
        }
      };
    return ExecutionContextCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ExecutionContextCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ExecutionContextCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ExecutionContextCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ExecutionContextCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ExecutionContextCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ExecutionContextCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ExecutionContextCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ExecutionContextCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ExecutionContextCommandControllerBlockingStub>() {
        @java.lang.Override
        public ExecutionContextCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ExecutionContextCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ExecutionContextCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ExecutionContextCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ExecutionContextCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ExecutionContextCommandControllerFutureStub>() {
        @java.lang.Override
        public ExecutionContextCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ExecutionContextCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ExecutionContextCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ExecutionContextCommandController handles write operations for ExecutionContext resources.
   * &#64;internal
   * Every write RPC uses is_skip_authorization with a real handler-level check
   * (the framework's declarative FGA options cannot express any of these):
   *   - create: the caller-class differs by transport. Internal in-process
   *     pipeline calls (agent execution, workflow execution, workflow recovery,
   *     MCP connect) are trusted — the parent operation already authorized the
   *     run against its session-or-org, and the EC is created before that parent
   *     is persisted, so it carries no resource to re-check. External callers
   *     must hold can_create_execution_in on metadata.org (the same bar that
   *     gates creating an execution in the org; held by members and guests).
   *     A declarative org option cannot encode the internal/external split.
   *   - apply: intentionally unannotated router — it delegates to create
   *     (create-or-fail; ExecutionContext has no update RPC) and the delegated
   *     pipeline runs under create's handler, authorization included.
   *   - delete: caller must have can_edit on execution_context:&lt;id&gt; (owner-only,
   *     per the execution_context FGA model). The FGA target is the loaded
   *     resource, so it cannot be a declarative method option.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an ExecutionContext.
     * &#64;internal
     * Router only: delegates to create when the resource does not exist and
     * fails with ALREADY_EXISTS when it does (no update RPC). Authorization is
     * inherited from the delegated create pipeline.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new ExecutionContext for an execution.
     * &#64;internal
     * Called by the execution pipelines (agent execution, workflow execution,
     * workflow recovery, MCP connect) as sub-steps, and reachable directly by
     * API clients. is_skip_authorization because the caller-class split cannot
     * be a declarative option: the create handler trusts internal in-process
     * calls (already authorized upstream) and requires external callers to hold
     * can_create_execution_in on metadata.org. The pipeline additionally grants
     * the caller the owner tuple, which gates all subsequent reads and delete.
     * </pre>
     */
    default void create(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an ExecutionContext.
     * &#64;internal
     * Called when execution completes. Handler-level auth (the FGA target is the
     * loaded resource, so it cannot be a declarative option): caller must have
     * can_edit on execution_context:&lt;id&gt;, which the FGA model resolves to the
     * owner written at create time.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ExecutionContextCommandController.
   * <pre>
   * ExecutionContextCommandController handles write operations for ExecutionContext resources.
   * &#64;internal
   * Every write RPC uses is_skip_authorization with a real handler-level check
   * (the framework's declarative FGA options cannot express any of these):
   *   - create: the caller-class differs by transport. Internal in-process
   *     pipeline calls (agent execution, workflow execution, workflow recovery,
   *     MCP connect) are trusted — the parent operation already authorized the
   *     run against its session-or-org, and the EC is created before that parent
   *     is persisted, so it carries no resource to re-check. External callers
   *     must hold can_create_execution_in on metadata.org (the same bar that
   *     gates creating an execution in the org; held by members and guests).
   *     A declarative org option cannot encode the internal/external split.
   *   - apply: intentionally unannotated router — it delegates to create
   *     (create-or-fail; ExecutionContext has no update RPC) and the delegated
   *     pipeline runs under create's handler, authorization included.
   *   - delete: caller must have can_edit on execution_context:&lt;id&gt; (owner-only,
   *     per the execution_context FGA model). The FGA target is the loaded
   *     resource, so it cannot be a declarative method option.
   * </pre>
   */
  public static abstract class ExecutionContextCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ExecutionContextCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ExecutionContextCommandController.
   * <pre>
   * ExecutionContextCommandController handles write operations for ExecutionContext resources.
   * &#64;internal
   * Every write RPC uses is_skip_authorization with a real handler-level check
   * (the framework's declarative FGA options cannot express any of these):
   *   - create: the caller-class differs by transport. Internal in-process
   *     pipeline calls (agent execution, workflow execution, workflow recovery,
   *     MCP connect) are trusted — the parent operation already authorized the
   *     run against its session-or-org, and the EC is created before that parent
   *     is persisted, so it carries no resource to re-check. External callers
   *     must hold can_create_execution_in on metadata.org (the same bar that
   *     gates creating an execution in the org; held by members and guests).
   *     A declarative org option cannot encode the internal/external split.
   *   - apply: intentionally unannotated router — it delegates to create
   *     (create-or-fail; ExecutionContext has no update RPC) and the delegated
   *     pipeline runs under create's handler, authorization included.
   *   - delete: caller must have can_edit on execution_context:&lt;id&gt; (owner-only,
   *     per the execution_context FGA model). The FGA target is the loaded
   *     resource, so it cannot be a declarative method option.
   * </pre>
   */
  public static final class ExecutionContextCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ExecutionContextCommandControllerStub> {
    private ExecutionContextCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ExecutionContextCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ExecutionContextCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an ExecutionContext.
     * &#64;internal
     * Router only: delegates to create when the resource does not exist and
     * fails with ALREADY_EXISTS when it does (no update RPC). Authorization is
     * inherited from the delegated create pipeline.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new ExecutionContext for an execution.
     * &#64;internal
     * Called by the execution pipelines (agent execution, workflow execution,
     * workflow recovery, MCP connect) as sub-steps, and reachable directly by
     * API clients. is_skip_authorization because the caller-class split cannot
     * be a declarative option: the create handler trusts internal in-process
     * calls (already authorized upstream) and requires external callers to hold
     * can_create_execution_in on metadata.org. The pipeline additionally grants
     * the caller the owner tuple, which gates all subsequent reads and delete.
     * </pre>
     */
    public void create(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an ExecutionContext.
     * &#64;internal
     * Called when execution completes. Handler-level auth (the FGA target is the
     * loaded resource, so it cannot be a declarative option): caller must have
     * can_edit on execution_context:&lt;id&gt;, which the FGA model resolves to the
     * owner written at create time.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ExecutionContextCommandController.
   * <pre>
   * ExecutionContextCommandController handles write operations for ExecutionContext resources.
   * &#64;internal
   * Every write RPC uses is_skip_authorization with a real handler-level check
   * (the framework's declarative FGA options cannot express any of these):
   *   - create: the caller-class differs by transport. Internal in-process
   *     pipeline calls (agent execution, workflow execution, workflow recovery,
   *     MCP connect) are trusted — the parent operation already authorized the
   *     run against its session-or-org, and the EC is created before that parent
   *     is persisted, so it carries no resource to re-check. External callers
   *     must hold can_create_execution_in on metadata.org (the same bar that
   *     gates creating an execution in the org; held by members and guests).
   *     A declarative org option cannot encode the internal/external split.
   *   - apply: intentionally unannotated router — it delegates to create
   *     (create-or-fail; ExecutionContext has no update RPC) and the delegated
   *     pipeline runs under create's handler, authorization included.
   *   - delete: caller must have can_edit on execution_context:&lt;id&gt; (owner-only,
   *     per the execution_context FGA model). The FGA target is the loaded
   *     resource, so it cannot be a declarative method option.
   * </pre>
   */
  public static final class ExecutionContextCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ExecutionContextCommandControllerBlockingV2Stub> {
    private ExecutionContextCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ExecutionContextCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ExecutionContextCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an ExecutionContext.
     * &#64;internal
     * Router only: delegates to create when the resource does not exist and
     * fails with ALREADY_EXISTS when it does (no update RPC). Authorization is
     * inherited from the delegated create pipeline.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext apply(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new ExecutionContext for an execution.
     * &#64;internal
     * Called by the execution pipelines (agent execution, workflow execution,
     * workflow recovery, MCP connect) as sub-steps, and reachable directly by
     * API clients. is_skip_authorization because the caller-class split cannot
     * be a declarative option: the create handler trusts internal in-process
     * calls (already authorized upstream) and requires external callers to hold
     * can_create_execution_in on metadata.org. The pipeline additionally grants
     * the caller the owner tuple, which gates all subsequent reads and delete.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext create(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an ExecutionContext.
     * &#64;internal
     * Called when execution completes. Handler-level auth (the FGA target is the
     * loaded resource, so it cannot be a declarative option): caller must have
     * can_edit on execution_context:&lt;id&gt;, which the FGA model resolves to the
     * owner written at create time.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ExecutionContextCommandController.
   * <pre>
   * ExecutionContextCommandController handles write operations for ExecutionContext resources.
   * &#64;internal
   * Every write RPC uses is_skip_authorization with a real handler-level check
   * (the framework's declarative FGA options cannot express any of these):
   *   - create: the caller-class differs by transport. Internal in-process
   *     pipeline calls (agent execution, workflow execution, workflow recovery,
   *     MCP connect) are trusted — the parent operation already authorized the
   *     run against its session-or-org, and the EC is created before that parent
   *     is persisted, so it carries no resource to re-check. External callers
   *     must hold can_create_execution_in on metadata.org (the same bar that
   *     gates creating an execution in the org; held by members and guests).
   *     A declarative org option cannot encode the internal/external split.
   *   - apply: intentionally unannotated router — it delegates to create
   *     (create-or-fail; ExecutionContext has no update RPC) and the delegated
   *     pipeline runs under create's handler, authorization included.
   *   - delete: caller must have can_edit on execution_context:&lt;id&gt; (owner-only,
   *     per the execution_context FGA model). The FGA target is the loaded
   *     resource, so it cannot be a declarative method option.
   * </pre>
   */
  public static final class ExecutionContextCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ExecutionContextCommandControllerBlockingStub> {
    private ExecutionContextCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ExecutionContextCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ExecutionContextCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an ExecutionContext.
     * &#64;internal
     * Router only: delegates to create when the resource does not exist and
     * fails with ALREADY_EXISTS when it does (no update RPC). Authorization is
     * inherited from the delegated create pipeline.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext apply(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new ExecutionContext for an execution.
     * &#64;internal
     * Called by the execution pipelines (agent execution, workflow execution,
     * workflow recovery, MCP connect) as sub-steps, and reachable directly by
     * API clients. is_skip_authorization because the caller-class split cannot
     * be a declarative option: the create handler trusts internal in-process
     * calls (already authorized upstream) and requires external callers to hold
     * can_create_execution_in on metadata.org. The pipeline additionally grants
     * the caller the owner tuple, which gates all subsequent reads and delete.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext create(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an ExecutionContext.
     * &#64;internal
     * Called when execution completes. Handler-level auth (the FGA target is the
     * loaded resource, so it cannot be a declarative option): caller must have
     * can_edit on execution_context:&lt;id&gt;, which the FGA model resolves to the
     * owner written at create time.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ExecutionContextCommandController.
   * <pre>
   * ExecutionContextCommandController handles write operations for ExecutionContext resources.
   * &#64;internal
   * Every write RPC uses is_skip_authorization with a real handler-level check
   * (the framework's declarative FGA options cannot express any of these):
   *   - create: the caller-class differs by transport. Internal in-process
   *     pipeline calls (agent execution, workflow execution, workflow recovery,
   *     MCP connect) are trusted — the parent operation already authorized the
   *     run against its session-or-org, and the EC is created before that parent
   *     is persisted, so it carries no resource to re-check. External callers
   *     must hold can_create_execution_in on metadata.org (the same bar that
   *     gates creating an execution in the org; held by members and guests).
   *     A declarative org option cannot encode the internal/external split.
   *   - apply: intentionally unannotated router — it delegates to create
   *     (create-or-fail; ExecutionContext has no update RPC) and the delegated
   *     pipeline runs under create's handler, authorization included.
   *   - delete: caller must have can_edit on execution_context:&lt;id&gt; (owner-only,
   *     per the execution_context FGA model). The FGA target is the loaded
   *     resource, so it cannot be a declarative method option.
   * </pre>
   */
  public static final class ExecutionContextCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ExecutionContextCommandControllerFutureStub> {
    private ExecutionContextCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ExecutionContextCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ExecutionContextCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an ExecutionContext.
     * &#64;internal
     * Router only: delegates to create when the resource does not exist and
     * fails with ALREADY_EXISTS when it does (no update RPC). Authorization is
     * inherited from the delegated create pipeline.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> apply(
        ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new ExecutionContext for an execution.
     * &#64;internal
     * Called by the execution pipelines (agent execution, workflow execution,
     * workflow recovery, MCP connect) as sub-steps, and reachable directly by
     * API clients. is_skip_authorization because the caller-class split cannot
     * be a declarative option: the create handler trusts internal in-process
     * calls (already authorized upstream) and requires external callers to hold
     * can_create_execution_in on metadata.org. The pipeline additionally grants
     * the caller the owner tuple, which gates all subsequent reads and delete.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> create(
        ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an ExecutionContext.
     * &#64;internal
     * Called when execution completes. Handler-level auth (the FGA target is the
     * loaded resource, so it cannot be a declarative option): caller must have
     * can_edit on execution_context:&lt;id&gt;, which the FGA model resolves to the
     * owner written at create time.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_DELETE = 2;

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
          serviceImpl.apply((ai.stigmer.agentic.executioncontext.v1.ExecutionContext) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.executioncontext.v1.ExecutionContext) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext>) responseObserver);
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
              ai.stigmer.agentic.executioncontext.v1.ExecutionContext,
              ai.stigmer.agentic.executioncontext.v1.ExecutionContext>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.executioncontext.v1.ExecutionContext,
              ai.stigmer.agentic.executioncontext.v1.ExecutionContext>(
                service, METHODID_CREATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.agentic.executioncontext.v1.ExecutionContext>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ExecutionContextCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ExecutionContextCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.executioncontext.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ExecutionContextCommandController");
    }
  }

  private static final class ExecutionContextCommandControllerFileDescriptorSupplier
      extends ExecutionContextCommandControllerBaseDescriptorSupplier {
    ExecutionContextCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ExecutionContextCommandControllerMethodDescriptorSupplier
      extends ExecutionContextCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ExecutionContextCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ExecutionContextCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ExecutionContextCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
