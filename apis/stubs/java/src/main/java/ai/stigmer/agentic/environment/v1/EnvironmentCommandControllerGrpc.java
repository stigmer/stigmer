package ai.stigmer.agentic.environment.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EnvironmentCommandController provides write operations for Environment resources.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EnvironmentCommandControllerGrpc {

  private EnvironmentCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.environment.v1.EnvironmentCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.environment.v1.Environment.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment> getApplyMethod;
    if ((getApplyMethod = EnvironmentCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getApplyMethod = EnvironmentCommandControllerGrpc.getApplyMethod) == null) {
          EnvironmentCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.environment.v1.Environment.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment> getCreateMethod;
    if ((getCreateMethod = EnvironmentCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getCreateMethod = EnvironmentCommandControllerGrpc.getCreateMethod) == null) {
          EnvironmentCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.environment.v1.Environment.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment,
      ai.stigmer.agentic.environment.v1.Environment> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment> getUpdateMethod;
    if ((getUpdateMethod = EnvironmentCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getUpdateMethod = EnvironmentCommandControllerGrpc.getUpdateMethod) == null) {
          EnvironmentCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.environment.v1.Environment, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.environment.v1.Environment> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.environment.v1.Environment> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.environment.v1.Environment> getDeleteMethod;
    if ((getDeleteMethod = EnvironmentCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (EnvironmentCommandControllerGrpc.class) {
        if ((getDeleteMethod = EnvironmentCommandControllerGrpc.getDeleteMethod) == null) {
          EnvironmentCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EnvironmentCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerStub>() {
        @java.lang.Override
        public EnvironmentCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentCommandControllerStub(channel, callOptions);
        }
      };
    return EnvironmentCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EnvironmentCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public EnvironmentCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EnvironmentCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EnvironmentCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerBlockingStub>() {
        @java.lang.Override
        public EnvironmentCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return EnvironmentCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EnvironmentCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentCommandControllerFutureStub>() {
        @java.lang.Override
        public EnvironmentCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentCommandControllerFutureStub(channel, callOptions);
        }
      };
    return EnvironmentCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EnvironmentCommandController provides write operations for Environment resources.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an Environment resource.
     * The authorization and state-operation are determined depending on whether the environment
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new Environment resource.
     * </pre>
     */
    default void create(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing Environment resource.
     * </pre>
     */
    default void update(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an Environment resource.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController provides write operations for Environment resources.
   * </pre>
   */
  public static abstract class EnvironmentCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EnvironmentCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController provides write operations for Environment resources.
   * </pre>
   */
  public static final class EnvironmentCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EnvironmentCommandControllerStub> {
    private EnvironmentCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an Environment resource.
     * The authorization and state-operation are determined depending on whether the environment
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new Environment resource.
     * </pre>
     */
    public void create(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing Environment resource.
     * </pre>
     */
    public void update(ai.stigmer.agentic.environment.v1.Environment request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an Environment resource.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController provides write operations for Environment resources.
   * </pre>
   */
  public static final class EnvironmentCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EnvironmentCommandControllerBlockingV2Stub> {
    private EnvironmentCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an Environment resource.
     * The authorization and state-operation are determined depending on whether the environment
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment apply(ai.stigmer.agentic.environment.v1.Environment request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new Environment resource.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment create(ai.stigmer.agentic.environment.v1.Environment request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing Environment resource.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment update(ai.stigmer.agentic.environment.v1.Environment request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an Environment resource.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController provides write operations for Environment resources.
   * </pre>
   */
  public static final class EnvironmentCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EnvironmentCommandControllerBlockingStub> {
    private EnvironmentCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an Environment resource.
     * The authorization and state-operation are determined depending on whether the environment
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment apply(ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new Environment resource.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment create(ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing Environment resource.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment update(ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an Environment resource.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EnvironmentCommandController.
   * <pre>
   * EnvironmentCommandController provides write operations for Environment resources.
   * </pre>
   */
  public static final class EnvironmentCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EnvironmentCommandControllerFutureStub> {
    private EnvironmentCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an Environment resource.
     * The authorization and state-operation are determined depending on whether the environment
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> apply(
        ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new Environment resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> create(
        ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing Environment resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> update(
        ai.stigmer.agentic.environment.v1.Environment request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an Environment resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;

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
          serviceImpl.apply((ai.stigmer.agentic.environment.v1.Environment) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.environment.v1.Environment) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.environment.v1.Environment) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
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
              ai.stigmer.agentic.environment.v1.Environment,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.environment.v1.Environment,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.environment.v1.Environment,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class EnvironmentCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EnvironmentCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.environment.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EnvironmentCommandController");
    }
  }

  private static final class EnvironmentCommandControllerFileDescriptorSupplier
      extends EnvironmentCommandControllerBaseDescriptorSupplier {
    EnvironmentCommandControllerFileDescriptorSupplier() {}
  }

  private static final class EnvironmentCommandControllerMethodDescriptorSupplier
      extends EnvironmentCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EnvironmentCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EnvironmentCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EnvironmentCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
