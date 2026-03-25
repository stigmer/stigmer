package ai.stigmer.agentic.executioncontext.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ExecutionContextCommandController provides write operations for ExecutionContext resources.
 * Authorization: All RPCs use is_skip_authorization with custom handler-level derived auth.
 * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
 * FGA model. Authorization is derived from the parent execution:
 *   - create: Caller must have can_edit on parent agent_execution or workflow_execution
 *   - delete: Caller must have can_edit on parent agent_execution or workflow_execution
 * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
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
   * ExecutionContextCommandController provides write operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level derived auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - create: Caller must have can_edit on parent agent_execution or workflow_execution
   *   - delete: Caller must have can_edit on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an ExecutionContext.
     * The authorization and state-operation are determined depending on whether the execution context
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new ExecutionContext (called by execution pipeline on behalf of the user).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
     * </pre>
     */
    default void create(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an ExecutionContext (called when execution completes).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
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
   * ExecutionContextCommandController provides write operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level derived auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - create: Caller must have can_edit on parent agent_execution or workflow_execution
   *   - delete: Caller must have can_edit on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
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
   * ExecutionContextCommandController provides write operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level derived auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - create: Caller must have can_edit on parent agent_execution or workflow_execution
   *   - delete: Caller must have can_edit on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
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
     * The authorization and state-operation are determined depending on whether the execution context
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new ExecutionContext (called by execution pipeline on behalf of the user).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
     * </pre>
     */
    public void create(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an ExecutionContext (called when execution completes).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
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
   * ExecutionContextCommandController provides write operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level derived auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - create: Caller must have can_edit on parent agent_execution or workflow_execution
   *   - delete: Caller must have can_edit on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
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
     * The authorization and state-operation are determined depending on whether the execution context
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext apply(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new ExecutionContext (called by execution pipeline on behalf of the user).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext create(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an ExecutionContext (called when execution completes).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
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
   * ExecutionContextCommandController provides write operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level derived auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - create: Caller must have can_edit on parent agent_execution or workflow_execution
   *   - delete: Caller must have can_edit on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
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
     * The authorization and state-operation are determined depending on whether the execution context
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext apply(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new ExecutionContext (called by execution pipeline on behalf of the user).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext create(ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an ExecutionContext (called when execution completes).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
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
   * ExecutionContextCommandController provides write operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level derived auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - create: Caller must have can_edit on parent agent_execution or workflow_execution
   *   - delete: Caller must have can_edit on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
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
     * The authorization and state-operation are determined depending on whether the execution context
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> apply(
        ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new ExecutionContext (called by execution pipeline on behalf of the user).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> create(
        ai.stigmer.agentic.executioncontext.v1.ExecutionContext request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an ExecutionContext (called when execution completes).
     * Handler-level derived auth: checks can_edit on parent agent_execution or workflow_execution.
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
