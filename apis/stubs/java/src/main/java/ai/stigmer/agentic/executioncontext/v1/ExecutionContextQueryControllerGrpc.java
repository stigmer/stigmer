package ai.stigmer.agentic.executioncontext.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ExecutionContextQueryController provides read operations for ExecutionContext resources.
 * Authorization: All RPCs use is_skip_authorization with custom handler-level auth.
 * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
 * FGA model. Authorization is derived from the parent execution:
 *   - get/getByReference: System-only (internal service lookups)
 *   - getByExecutionId: Handler checks can_view on parent agent_execution or workflow_execution
 * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ExecutionContextQueryControllerGrpc {

  private ExecutionContextQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.executioncontext.v1.ExecutionContextQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContextId,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.executioncontext.v1.ExecutionContextId.class,
      responseType = ai.stigmer.agentic.executioncontext.v1.ExecutionContext.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContextId,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContextId, ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getGetMethod;
    if ((getGetMethod = ExecutionContextQueryControllerGrpc.getGetMethod) == null) {
      synchronized (ExecutionContextQueryControllerGrpc.class) {
        if ((getGetMethod = ExecutionContextQueryControllerGrpc.getGetMethod) == null) {
          ExecutionContextQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.executioncontext.v1.ExecutionContextId, ai.stigmer.agentic.executioncontext.v1.ExecutionContext>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContextId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContext.getDefaultInstance()))
              .setSchemaDescriptor(new ExecutionContextQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.executioncontext.v1.ExecutionContext.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = ExecutionContextQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (ExecutionContextQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = ExecutionContextQueryControllerGrpc.getGetByReferenceMethod) == null) {
          ExecutionContextQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.executioncontext.v1.ExecutionContext>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContext.getDefaultInstance()))
              .setSchemaDescriptor(new ExecutionContextQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getGetByExecutionIdMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByExecutionId",
      requestType = ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput.class,
      responseType = ai.stigmer.agentic.executioncontext.v1.ExecutionContext.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput,
      ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getGetByExecutionIdMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput, ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getGetByExecutionIdMethod;
    if ((getGetByExecutionIdMethod = ExecutionContextQueryControllerGrpc.getGetByExecutionIdMethod) == null) {
      synchronized (ExecutionContextQueryControllerGrpc.class) {
        if ((getGetByExecutionIdMethod = ExecutionContextQueryControllerGrpc.getGetByExecutionIdMethod) == null) {
          ExecutionContextQueryControllerGrpc.getGetByExecutionIdMethod = getGetByExecutionIdMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput, ai.stigmer.agentic.executioncontext.v1.ExecutionContext>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByExecutionId"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.executioncontext.v1.ExecutionContext.getDefaultInstance()))
              .setSchemaDescriptor(new ExecutionContextQueryControllerMethodDescriptorSupplier("getByExecutionId"))
              .build();
        }
      }
    }
    return getGetByExecutionIdMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ExecutionContextQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ExecutionContextQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ExecutionContextQueryControllerStub>() {
        @java.lang.Override
        public ExecutionContextQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ExecutionContextQueryControllerStub(channel, callOptions);
        }
      };
    return ExecutionContextQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ExecutionContextQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ExecutionContextQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ExecutionContextQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ExecutionContextQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ExecutionContextQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ExecutionContextQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ExecutionContextQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ExecutionContextQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ExecutionContextQueryControllerBlockingStub>() {
        @java.lang.Override
        public ExecutionContextQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ExecutionContextQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ExecutionContextQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ExecutionContextQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ExecutionContextQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ExecutionContextQueryControllerFutureStub>() {
        @java.lang.Override
        public ExecutionContextQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ExecutionContextQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ExecutionContextQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ExecutionContextQueryController provides read operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - get/getByReference: System-only (internal service lookups)
   *   - getByExecutionId: Handler checks can_view on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an ExecutionContext by ID.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    default void get(ai.stigmer.agentic.executioncontext.v1.ExecutionContextId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an ExecutionContext by reference.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an ExecutionContext by the execution ID it belongs to.
     * This is the primary lookup method used by runners to retrieve the merged
     * environment variables during workflow/agent execution. The returned context
     * contains decrypted secrets for runner consumption.
     * Handler-level auth: checks can_view on parent agent_execution or workflow_execution.
     * The handler looks up the ExecutionContext, extracts the execution_id from spec,
     * determines the parent resource kind, and verifies the caller has can_view permission.
     * </pre>
     */
    default void getByExecutionId(ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByExecutionIdMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ExecutionContextQueryController.
   * <pre>
   * ExecutionContextQueryController provides read operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - get/getByReference: System-only (internal service lookups)
   *   - getByExecutionId: Handler checks can_view on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
   * </pre>
   */
  public static abstract class ExecutionContextQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ExecutionContextQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ExecutionContextQueryController.
   * <pre>
   * ExecutionContextQueryController provides read operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - get/getByReference: System-only (internal service lookups)
   *   - getByExecutionId: Handler checks can_view on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
   * </pre>
   */
  public static final class ExecutionContextQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ExecutionContextQueryControllerStub> {
    private ExecutionContextQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ExecutionContextQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ExecutionContextQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an ExecutionContext by ID.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    public void get(ai.stigmer.agentic.executioncontext.v1.ExecutionContextId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an ExecutionContext by reference.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an ExecutionContext by the execution ID it belongs to.
     * This is the primary lookup method used by runners to retrieve the merged
     * environment variables during workflow/agent execution. The returned context
     * contains decrypted secrets for runner consumption.
     * Handler-level auth: checks can_view on parent agent_execution or workflow_execution.
     * The handler looks up the ExecutionContext, extracts the execution_id from spec,
     * determines the parent resource kind, and verifies the caller has can_view permission.
     * </pre>
     */
    public void getByExecutionId(ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByExecutionIdMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ExecutionContextQueryController.
   * <pre>
   * ExecutionContextQueryController provides read operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - get/getByReference: System-only (internal service lookups)
   *   - getByExecutionId: Handler checks can_view on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
   * </pre>
   */
  public static final class ExecutionContextQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ExecutionContextQueryControllerBlockingV2Stub> {
    private ExecutionContextQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ExecutionContextQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ExecutionContextQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an ExecutionContext by ID.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext get(ai.stigmer.agentic.executioncontext.v1.ExecutionContextId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an ExecutionContext by reference.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an ExecutionContext by the execution ID it belongs to.
     * This is the primary lookup method used by runners to retrieve the merged
     * environment variables during workflow/agent execution. The returned context
     * contains decrypted secrets for runner consumption.
     * Handler-level auth: checks can_view on parent agent_execution or workflow_execution.
     * The handler looks up the ExecutionContext, extracts the execution_id from spec,
     * determines the parent resource kind, and verifies the caller has can_view permission.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext getByExecutionId(ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByExecutionIdMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ExecutionContextQueryController.
   * <pre>
   * ExecutionContextQueryController provides read operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - get/getByReference: System-only (internal service lookups)
   *   - getByExecutionId: Handler checks can_view on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
   * </pre>
   */
  public static final class ExecutionContextQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ExecutionContextQueryControllerBlockingStub> {
    private ExecutionContextQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ExecutionContextQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ExecutionContextQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an ExecutionContext by ID.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext get(ai.stigmer.agentic.executioncontext.v1.ExecutionContextId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an ExecutionContext by reference.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an ExecutionContext by the execution ID it belongs to.
     * This is the primary lookup method used by runners to retrieve the merged
     * environment variables during workflow/agent execution. The returned context
     * contains decrypted secrets for runner consumption.
     * Handler-level auth: checks can_view on parent agent_execution or workflow_execution.
     * The handler looks up the ExecutionContext, extracts the execution_id from spec,
     * determines the parent resource kind, and verifies the caller has can_view permission.
     * </pre>
     */
    public ai.stigmer.agentic.executioncontext.v1.ExecutionContext getByExecutionId(ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByExecutionIdMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ExecutionContextQueryController.
   * <pre>
   * ExecutionContextQueryController provides read operations for ExecutionContext resources.
   * Authorization: All RPCs use is_skip_authorization with custom handler-level auth.
   * ExecutionContext is ephemeral (1:1 with its parent execution) and has no dedicated
   * FGA model. Authorization is derived from the parent execution:
   *   - get/getByReference: System-only (internal service lookups)
   *   - getByExecutionId: Handler checks can_view on parent agent_execution or workflow_execution
   * This avoids FGA tuple churn for short-lived resources while maintaining proper access control.
   * </pre>
   */
  public static final class ExecutionContextQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ExecutionContextQueryControllerFutureStub> {
    private ExecutionContextQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ExecutionContextQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ExecutionContextQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an ExecutionContext by ID.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> get(
        ai.stigmer.agentic.executioncontext.v1.ExecutionContextId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an ExecutionContext by reference.
     * Handler-level auth: system-only internal lookup.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an ExecutionContext by the execution ID it belongs to.
     * This is the primary lookup method used by runners to retrieve the merged
     * environment variables during workflow/agent execution. The returned context
     * contains decrypted secrets for runner consumption.
     * Handler-level auth: checks can_view on parent agent_execution or workflow_execution.
     * The handler looks up the ExecutionContext, extracts the execution_id from spec,
     * determines the parent resource kind, and verifies the caller has can_view permission.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.executioncontext.v1.ExecutionContext> getByExecutionId(
        ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByExecutionIdMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_GET_BY_EXECUTION_ID = 2;

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
        case METHODID_GET:
          serviceImpl.get((ai.stigmer.agentic.executioncontext.v1.ExecutionContextId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.executioncontext.v1.ExecutionContext>) responseObserver);
          break;
        case METHODID_GET_BY_EXECUTION_ID:
          serviceImpl.getByExecutionId((ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput) request,
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
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.executioncontext.v1.ExecutionContextId,
              ai.stigmer.agentic.executioncontext.v1.ExecutionContext>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.executioncontext.v1.ExecutionContext>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getGetByExecutionIdMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.executioncontext.v1.ExecutionContextExecutionIdInput,
              ai.stigmer.agentic.executioncontext.v1.ExecutionContext>(
                service, METHODID_GET_BY_EXECUTION_ID)))
        .build();
  }

  private static abstract class ExecutionContextQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ExecutionContextQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.executioncontext.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ExecutionContextQueryController");
    }
  }

  private static final class ExecutionContextQueryControllerFileDescriptorSupplier
      extends ExecutionContextQueryControllerBaseDescriptorSupplier {
    ExecutionContextQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ExecutionContextQueryControllerMethodDescriptorSupplier
      extends ExecutionContextQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ExecutionContextQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ExecutionContextQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ExecutionContextQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getGetByExecutionIdMethod())
              .build();
        }
      }
    }
    return result;
  }
}
