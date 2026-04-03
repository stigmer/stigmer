package ai.stigmer.iam.apikey.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ApiKeyCommandController handles write operations for API keys.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ApiKeyCommandControllerGrpc {

  private ApiKeyCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.apikey.v1.ApiKeyCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKey,
      ai.stigmer.iam.apikey.v1.ApiKey> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.apikey.v1.ApiKey.class,
      responseType = ai.stigmer.iam.apikey.v1.ApiKey.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKey,
      ai.stigmer.iam.apikey.v1.ApiKey> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKey, ai.stigmer.iam.apikey.v1.ApiKey> getCreateMethod;
    if ((getCreateMethod = ApiKeyCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (ApiKeyCommandControllerGrpc.class) {
        if ((getCreateMethod = ApiKeyCommandControllerGrpc.getCreateMethod) == null) {
          ApiKeyCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.apikey.v1.ApiKey, ai.stigmer.iam.apikey.v1.ApiKey>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKey.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKey.getDefaultInstance()))
              .setSchemaDescriptor(new ApiKeyCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKey,
      ai.stigmer.iam.apikey.v1.ApiKey> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.iam.apikey.v1.ApiKey.class,
      responseType = ai.stigmer.iam.apikey.v1.ApiKey.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKey,
      ai.stigmer.iam.apikey.v1.ApiKey> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKey, ai.stigmer.iam.apikey.v1.ApiKey> getUpdateMethod;
    if ((getUpdateMethod = ApiKeyCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (ApiKeyCommandControllerGrpc.class) {
        if ((getUpdateMethod = ApiKeyCommandControllerGrpc.getUpdateMethod) == null) {
          ApiKeyCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.apikey.v1.ApiKey, ai.stigmer.iam.apikey.v1.ApiKey>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKey.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKey.getDefaultInstance()))
              .setSchemaDescriptor(new ApiKeyCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKeyId,
      ai.stigmer.iam.apikey.v1.ApiKey> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.iam.apikey.v1.ApiKeyId.class,
      responseType = ai.stigmer.iam.apikey.v1.ApiKey.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKeyId,
      ai.stigmer.iam.apikey.v1.ApiKey> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKeyId, ai.stigmer.iam.apikey.v1.ApiKey> getDeleteMethod;
    if ((getDeleteMethod = ApiKeyCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ApiKeyCommandControllerGrpc.class) {
        if ((getDeleteMethod = ApiKeyCommandControllerGrpc.getDeleteMethod) == null) {
          ApiKeyCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.apikey.v1.ApiKeyId, ai.stigmer.iam.apikey.v1.ApiKey>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKeyId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKey.getDefaultInstance()))
              .setSchemaDescriptor(new ApiKeyCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ApiKeyCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ApiKeyCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ApiKeyCommandControllerStub>() {
        @java.lang.Override
        public ApiKeyCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ApiKeyCommandControllerStub(channel, callOptions);
        }
      };
    return ApiKeyCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ApiKeyCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ApiKeyCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ApiKeyCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ApiKeyCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ApiKeyCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ApiKeyCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ApiKeyCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ApiKeyCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ApiKeyCommandControllerBlockingStub>() {
        @java.lang.Override
        public ApiKeyCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ApiKeyCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ApiKeyCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ApiKeyCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ApiKeyCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ApiKeyCommandControllerFutureStub>() {
        @java.lang.Override
        public ApiKeyCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ApiKeyCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ApiKeyCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ApiKeyCommandController handles write operations for API keys.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a new API key for the authenticated user.
     * Any authenticated user can create API keys.
     * </pre>
     */
    default void create(ai.stigmer.iam.apikey.v1.ApiKey request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing API key.
     * </pre>
     */
    default void update(ai.stigmer.iam.apikey.v1.ApiKey request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an API key.
     * </pre>
     */
    default void delete(ai.stigmer.iam.apikey.v1.ApiKeyId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ApiKeyCommandController.
   * <pre>
   * ApiKeyCommandController handles write operations for API keys.
   * </pre>
   */
  public static abstract class ApiKeyCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ApiKeyCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ApiKeyCommandController.
   * <pre>
   * ApiKeyCommandController handles write operations for API keys.
   * </pre>
   */
  public static final class ApiKeyCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ApiKeyCommandControllerStub> {
    private ApiKeyCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ApiKeyCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ApiKeyCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new API key for the authenticated user.
     * Any authenticated user can create API keys.
     * </pre>
     */
    public void create(ai.stigmer.iam.apikey.v1.ApiKey request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing API key.
     * </pre>
     */
    public void update(ai.stigmer.iam.apikey.v1.ApiKey request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an API key.
     * </pre>
     */
    public void delete(ai.stigmer.iam.apikey.v1.ApiKeyId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ApiKeyCommandController.
   * <pre>
   * ApiKeyCommandController handles write operations for API keys.
   * </pre>
   */
  public static final class ApiKeyCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ApiKeyCommandControllerBlockingV2Stub> {
    private ApiKeyCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ApiKeyCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ApiKeyCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new API key for the authenticated user.
     * Any authenticated user can create API keys.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey create(ai.stigmer.iam.apikey.v1.ApiKey request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing API key.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey update(ai.stigmer.iam.apikey.v1.ApiKey request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an API key.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey delete(ai.stigmer.iam.apikey.v1.ApiKeyId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ApiKeyCommandController.
   * <pre>
   * ApiKeyCommandController handles write operations for API keys.
   * </pre>
   */
  public static final class ApiKeyCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ApiKeyCommandControllerBlockingStub> {
    private ApiKeyCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ApiKeyCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ApiKeyCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new API key for the authenticated user.
     * Any authenticated user can create API keys.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey create(ai.stigmer.iam.apikey.v1.ApiKey request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing API key.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey update(ai.stigmer.iam.apikey.v1.ApiKey request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an API key.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey delete(ai.stigmer.iam.apikey.v1.ApiKeyId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ApiKeyCommandController.
   * <pre>
   * ApiKeyCommandController handles write operations for API keys.
   * </pre>
   */
  public static final class ApiKeyCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ApiKeyCommandControllerFutureStub> {
    private ApiKeyCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ApiKeyCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ApiKeyCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new API key for the authenticated user.
     * Any authenticated user can create API keys.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.apikey.v1.ApiKey> create(
        ai.stigmer.iam.apikey.v1.ApiKey request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing API key.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.apikey.v1.ApiKey> update(
        ai.stigmer.iam.apikey.v1.ApiKey request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an API key.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.apikey.v1.ApiKey> delete(
        ai.stigmer.iam.apikey.v1.ApiKeyId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
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
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.iam.apikey.v1.ApiKey) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.iam.apikey.v1.ApiKey) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.iam.apikey.v1.ApiKeyId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey>) responseObserver);
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
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.apikey.v1.ApiKey,
              ai.stigmer.iam.apikey.v1.ApiKey>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.apikey.v1.ApiKey,
              ai.stigmer.iam.apikey.v1.ApiKey>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.apikey.v1.ApiKeyId,
              ai.stigmer.iam.apikey.v1.ApiKey>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ApiKeyCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ApiKeyCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.apikey.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ApiKeyCommandController");
    }
  }

  private static final class ApiKeyCommandControllerFileDescriptorSupplier
      extends ApiKeyCommandControllerBaseDescriptorSupplier {
    ApiKeyCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ApiKeyCommandControllerMethodDescriptorSupplier
      extends ApiKeyCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ApiKeyCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ApiKeyCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ApiKeyCommandControllerFileDescriptorSupplier())
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
