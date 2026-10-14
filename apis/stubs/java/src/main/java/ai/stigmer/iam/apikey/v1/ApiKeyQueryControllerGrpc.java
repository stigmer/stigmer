package ai.stigmer.iam.apikey.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ApiKeyQueryController handles read operations for API keys.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ApiKeyQueryControllerGrpc {

  private ApiKeyQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.apikey.v1.ApiKeyQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKeyId,
      ai.stigmer.iam.apikey.v1.ApiKey> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.iam.apikey.v1.ApiKeyId.class,
      responseType = ai.stigmer.iam.apikey.v1.ApiKey.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKeyId,
      ai.stigmer.iam.apikey.v1.ApiKey> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKeyId, ai.stigmer.iam.apikey.v1.ApiKey> getGetMethod;
    if ((getGetMethod = ApiKeyQueryControllerGrpc.getGetMethod) == null) {
      synchronized (ApiKeyQueryControllerGrpc.class) {
        if ((getGetMethod = ApiKeyQueryControllerGrpc.getGetMethod) == null) {
          ApiKeyQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.apikey.v1.ApiKeyId, ai.stigmer.iam.apikey.v1.ApiKey>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKeyId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKey.getDefaultInstance()))
              .setSchemaDescriptor(new ApiKeyQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKeyHash,
      ai.stigmer.iam.apikey.v1.ApiKey> getGetByKeyHashMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByKeyHash",
      requestType = ai.stigmer.iam.apikey.v1.ApiKeyHash.class,
      responseType = ai.stigmer.iam.apikey.v1.ApiKey.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKeyHash,
      ai.stigmer.iam.apikey.v1.ApiKey> getGetByKeyHashMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ApiKeyHash, ai.stigmer.iam.apikey.v1.ApiKey> getGetByKeyHashMethod;
    if ((getGetByKeyHashMethod = ApiKeyQueryControllerGrpc.getGetByKeyHashMethod) == null) {
      synchronized (ApiKeyQueryControllerGrpc.class) {
        if ((getGetByKeyHashMethod = ApiKeyQueryControllerGrpc.getGetByKeyHashMethod) == null) {
          ApiKeyQueryControllerGrpc.getGetByKeyHashMethod = getGetByKeyHashMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.apikey.v1.ApiKeyHash, ai.stigmer.iam.apikey.v1.ApiKey>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByKeyHash"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKeyHash.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKey.getDefaultInstance()))
              .setSchemaDescriptor(new ApiKeyQueryControllerMethodDescriptorSupplier("getByKeyHash"))
              .build();
        }
      }
    }
    return getGetByKeyHashMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ListApiKeysInput,
      ai.stigmer.iam.apikey.v1.ApiKeys> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.iam.apikey.v1.ListApiKeysInput.class,
      responseType = ai.stigmer.iam.apikey.v1.ApiKeys.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ListApiKeysInput,
      ai.stigmer.iam.apikey.v1.ApiKeys> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ListApiKeysInput, ai.stigmer.iam.apikey.v1.ApiKeys> getListMethod;
    if ((getListMethod = ApiKeyQueryControllerGrpc.getListMethod) == null) {
      synchronized (ApiKeyQueryControllerGrpc.class) {
        if ((getListMethod = ApiKeyQueryControllerGrpc.getListMethod) == null) {
          ApiKeyQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.apikey.v1.ListApiKeysInput, ai.stigmer.iam.apikey.v1.ApiKeys>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ListApiKeysInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKeys.getDefaultInstance()))
              .setSchemaDescriptor(new ApiKeyQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput,
      ai.stigmer.iam.apikey.v1.ApiKeys> getListByAccountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByAccount",
      requestType = ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput.class,
      responseType = ai.stigmer.iam.apikey.v1.ApiKeys.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput,
      ai.stigmer.iam.apikey.v1.ApiKeys> getListByAccountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput, ai.stigmer.iam.apikey.v1.ApiKeys> getListByAccountMethod;
    if ((getListByAccountMethod = ApiKeyQueryControllerGrpc.getListByAccountMethod) == null) {
      synchronized (ApiKeyQueryControllerGrpc.class) {
        if ((getListByAccountMethod = ApiKeyQueryControllerGrpc.getListByAccountMethod) == null) {
          ApiKeyQueryControllerGrpc.getListByAccountMethod = getListByAccountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput, ai.stigmer.iam.apikey.v1.ApiKeys>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByAccount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.apikey.v1.ApiKeys.getDefaultInstance()))
              .setSchemaDescriptor(new ApiKeyQueryControllerMethodDescriptorSupplier("listByAccount"))
              .build();
        }
      }
    }
    return getListByAccountMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ApiKeyQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ApiKeyQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ApiKeyQueryControllerStub>() {
        @java.lang.Override
        public ApiKeyQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ApiKeyQueryControllerStub(channel, callOptions);
        }
      };
    return ApiKeyQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ApiKeyQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ApiKeyQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ApiKeyQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ApiKeyQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ApiKeyQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ApiKeyQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ApiKeyQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ApiKeyQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ApiKeyQueryControllerBlockingStub>() {
        @java.lang.Override
        public ApiKeyQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ApiKeyQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ApiKeyQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ApiKeyQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ApiKeyQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ApiKeyQueryControllerFutureStub>() {
        @java.lang.Override
        public ApiKeyQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ApiKeyQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ApiKeyQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ApiKeyQueryController handles read operations for API keys.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an API key by its unique identifier.
     * </pre>
     */
    default void get(ai.stigmer.iam.apikey.v1.ApiKeyId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an API key by its hashed key value.
     * </pre>
     */
    default void getByKeyHash(ai.stigmer.iam.apikey.v1.ApiKeyHash request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByKeyHashMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all API keys belonging to the authenticated user.
     * Returns only the keys that speak for the identity account in the auth
     * header; a service account's keys are listed with listByAccount.
     * </pre>
     */
    default void list(ai.stigmer.iam.apikey.v1.ListApiKeysInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKeys> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the API keys that speak for an identity account.
     * An organization's admins list a service account's keys with it; a person
     * lists their own.
     * Authorization: Requires can_view on the identity account.
     * </pre>
     */
    default void listByAccount(ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKeys> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByAccountMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ApiKeyQueryController.
   * <pre>
   * ApiKeyQueryController handles read operations for API keys.
   * </pre>
   */
  public static abstract class ApiKeyQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ApiKeyQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ApiKeyQueryController.
   * <pre>
   * ApiKeyQueryController handles read operations for API keys.
   * </pre>
   */
  public static final class ApiKeyQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ApiKeyQueryControllerStub> {
    private ApiKeyQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ApiKeyQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ApiKeyQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an API key by its unique identifier.
     * </pre>
     */
    public void get(ai.stigmer.iam.apikey.v1.ApiKeyId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an API key by its hashed key value.
     * </pre>
     */
    public void getByKeyHash(ai.stigmer.iam.apikey.v1.ApiKeyHash request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByKeyHashMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all API keys belonging to the authenticated user.
     * Returns only the keys that speak for the identity account in the auth
     * header; a service account's keys are listed with listByAccount.
     * </pre>
     */
    public void list(ai.stigmer.iam.apikey.v1.ListApiKeysInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKeys> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the API keys that speak for an identity account.
     * An organization's admins list a service account's keys with it; a person
     * lists their own.
     * Authorization: Requires can_view on the identity account.
     * </pre>
     */
    public void listByAccount(ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKeys> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByAccountMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ApiKeyQueryController.
   * <pre>
   * ApiKeyQueryController handles read operations for API keys.
   * </pre>
   */
  public static final class ApiKeyQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ApiKeyQueryControllerBlockingV2Stub> {
    private ApiKeyQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ApiKeyQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ApiKeyQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an API key by its unique identifier.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey get(ai.stigmer.iam.apikey.v1.ApiKeyId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an API key by its hashed key value.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey getByKeyHash(ai.stigmer.iam.apikey.v1.ApiKeyHash request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByKeyHashMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all API keys belonging to the authenticated user.
     * Returns only the keys that speak for the identity account in the auth
     * header; a service account's keys are listed with listByAccount.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKeys list(ai.stigmer.iam.apikey.v1.ListApiKeysInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the API keys that speak for an identity account.
     * An organization's admins list a service account's keys with it; a person
     * lists their own.
     * Authorization: Requires can_view on the identity account.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKeys listByAccount(ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByAccountMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ApiKeyQueryController.
   * <pre>
   * ApiKeyQueryController handles read operations for API keys.
   * </pre>
   */
  public static final class ApiKeyQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ApiKeyQueryControllerBlockingStub> {
    private ApiKeyQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ApiKeyQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ApiKeyQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an API key by its unique identifier.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey get(ai.stigmer.iam.apikey.v1.ApiKeyId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an API key by its hashed key value.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKey getByKeyHash(ai.stigmer.iam.apikey.v1.ApiKeyHash request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByKeyHashMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all API keys belonging to the authenticated user.
     * Returns only the keys that speak for the identity account in the auth
     * header; a service account's keys are listed with listByAccount.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKeys list(ai.stigmer.iam.apikey.v1.ListApiKeysInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the API keys that speak for an identity account.
     * An organization's admins list a service account's keys with it; a person
     * lists their own.
     * Authorization: Requires can_view on the identity account.
     * </pre>
     */
    public ai.stigmer.iam.apikey.v1.ApiKeys listByAccount(ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByAccountMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ApiKeyQueryController.
   * <pre>
   * ApiKeyQueryController handles read operations for API keys.
   * </pre>
   */
  public static final class ApiKeyQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ApiKeyQueryControllerFutureStub> {
    private ApiKeyQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ApiKeyQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ApiKeyQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an API key by its unique identifier.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.apikey.v1.ApiKey> get(
        ai.stigmer.iam.apikey.v1.ApiKeyId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an API key by its hashed key value.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.apikey.v1.ApiKey> getByKeyHash(
        ai.stigmer.iam.apikey.v1.ApiKeyHash request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByKeyHashMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all API keys belonging to the authenticated user.
     * Returns only the keys that speak for the identity account in the auth
     * header; a service account's keys are listed with listByAccount.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.apikey.v1.ApiKeys> list(
        ai.stigmer.iam.apikey.v1.ListApiKeysInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the API keys that speak for an identity account.
     * An organization's admins list a service account's keys with it; a person
     * lists their own.
     * Authorization: Requires can_view on the identity account.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.apikey.v1.ApiKeys> listByAccount(
        ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByAccountMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_KEY_HASH = 1;
  private static final int METHODID_LIST = 2;
  private static final int METHODID_LIST_BY_ACCOUNT = 3;

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
          serviceImpl.get((ai.stigmer.iam.apikey.v1.ApiKeyId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey>) responseObserver);
          break;
        case METHODID_GET_BY_KEY_HASH:
          serviceImpl.getByKeyHash((ai.stigmer.iam.apikey.v1.ApiKeyHash) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKey>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.iam.apikey.v1.ListApiKeysInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKeys>) responseObserver);
          break;
        case METHODID_LIST_BY_ACCOUNT:
          serviceImpl.listByAccount((ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.apikey.v1.ApiKeys>) responseObserver);
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
              ai.stigmer.iam.apikey.v1.ApiKeyId,
              ai.stigmer.iam.apikey.v1.ApiKey>(
                service, METHODID_GET)))
        .addMethod(
          getGetByKeyHashMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.apikey.v1.ApiKeyHash,
              ai.stigmer.iam.apikey.v1.ApiKey>(
                service, METHODID_GET_BY_KEY_HASH)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.apikey.v1.ListApiKeysInput,
              ai.stigmer.iam.apikey.v1.ApiKeys>(
                service, METHODID_LIST)))
        .addMethod(
          getListByAccountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.apikey.v1.ListApiKeysByAccountInput,
              ai.stigmer.iam.apikey.v1.ApiKeys>(
                service, METHODID_LIST_BY_ACCOUNT)))
        .build();
  }

  private static abstract class ApiKeyQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ApiKeyQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.apikey.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ApiKeyQueryController");
    }
  }

  private static final class ApiKeyQueryControllerFileDescriptorSupplier
      extends ApiKeyQueryControllerBaseDescriptorSupplier {
    ApiKeyQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ApiKeyQueryControllerMethodDescriptorSupplier
      extends ApiKeyQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ApiKeyQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ApiKeyQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ApiKeyQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByKeyHashMethod())
              .addMethod(getListMethod())
              .addMethod(getListByAccountMethod())
              .build();
        }
      }
    }
    return result;
  }
}
