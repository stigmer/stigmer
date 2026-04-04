package ai.stigmer.agentic.environment.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EnvironmentQueryController handles read operations for environments.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EnvironmentQueryControllerGrpc {

  private EnvironmentQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.environment.v1.EnvironmentQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.environment.v1.Environment> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.environment.v1.Environment> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.environment.v1.Environment> getGetMethod;
    if ((getGetMethod = EnvironmentQueryControllerGrpc.getGetMethod) == null) {
      synchronized (EnvironmentQueryControllerGrpc.class) {
        if ((getGetMethod = EnvironmentQueryControllerGrpc.getGetMethod) == null) {
          EnvironmentQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.environment.v1.Environment> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.environment.v1.Environment.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.environment.v1.Environment> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.environment.v1.Environment> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = EnvironmentQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (EnvironmentQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = EnvironmentQueryControllerGrpc.getGetByReferenceMethod) == null) {
          EnvironmentQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.environment.v1.Environment>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.Environment.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput,
      ai.stigmer.agentic.environment.v1.EnvironmentValue> getGetSecretValueMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getSecretValue",
      requestType = ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput.class,
      responseType = ai.stigmer.agentic.environment.v1.EnvironmentValue.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput,
      ai.stigmer.agentic.environment.v1.EnvironmentValue> getGetSecretValueMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput, ai.stigmer.agentic.environment.v1.EnvironmentValue> getGetSecretValueMethod;
    if ((getGetSecretValueMethod = EnvironmentQueryControllerGrpc.getGetSecretValueMethod) == null) {
      synchronized (EnvironmentQueryControllerGrpc.class) {
        if ((getGetSecretValueMethod = EnvironmentQueryControllerGrpc.getGetSecretValueMethod) == null) {
          EnvironmentQueryControllerGrpc.getGetSecretValueMethod = getGetSecretValueMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput, ai.stigmer.agentic.environment.v1.EnvironmentValue>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getSecretValue"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.EnvironmentValue.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentQueryControllerMethodDescriptorSupplier("getSecretValue"))
              .build();
        }
      }
    }
    return getGetSecretValueMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest,
      ai.stigmer.agentic.environment.v1.EnvironmentList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest.class,
      responseType = ai.stigmer.agentic.environment.v1.EnvironmentList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest,
      ai.stigmer.agentic.environment.v1.EnvironmentList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest, ai.stigmer.agentic.environment.v1.EnvironmentList> getListMethod;
    if ((getListMethod = EnvironmentQueryControllerGrpc.getListMethod) == null) {
      synchronized (EnvironmentQueryControllerGrpc.class) {
        if ((getListMethod = EnvironmentQueryControllerGrpc.getListMethod) == null) {
          EnvironmentQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest, ai.stigmer.agentic.environment.v1.EnvironmentList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.environment.v1.EnvironmentList.getDefaultInstance()))
              .setSchemaDescriptor(new EnvironmentQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EnvironmentQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerStub>() {
        @java.lang.Override
        public EnvironmentQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentQueryControllerStub(channel, callOptions);
        }
      };
    return EnvironmentQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EnvironmentQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public EnvironmentQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EnvironmentQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EnvironmentQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerBlockingStub>() {
        @java.lang.Override
        public EnvironmentQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return EnvironmentQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EnvironmentQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EnvironmentQueryControllerFutureStub>() {
        @java.lang.Override
        public EnvironmentQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EnvironmentQueryControllerFutureStub(channel, callOptions);
        }
      };
    return EnvironmentQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EnvironmentQueryController handles read operations for environments.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an environment by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the environment resource.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an environment by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/aws-prod" to the full Environment resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get the unredacted value of a single secret key in an environment.
     * Returns the EnvironmentValue with the decrypted value for exactly one key.
     * &#64;internal
     * Creator-only: FGA authorization grants can_read_secrets via the creator relation.
     * </pre>
     */
    default void getSecretValue(ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.EnvironmentValue> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetSecretValueMethod(), responseObserver);
    }

    /**
     * <pre>
     * List environments with optional label filtering.
     * Secret values are redacted in the response.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    default void list(ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.EnvironmentList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController handles read operations for environments.
   * </pre>
   */
  public static abstract class EnvironmentQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EnvironmentQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController handles read operations for environments.
   * </pre>
   */
  public static final class EnvironmentQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EnvironmentQueryControllerStub> {
    private EnvironmentQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an environment by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the environment resource.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an environment by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/aws-prod" to the full Environment resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get the unredacted value of a single secret key in an environment.
     * Returns the EnvironmentValue with the decrypted value for exactly one key.
     * &#64;internal
     * Creator-only: FGA authorization grants can_read_secrets via the creator relation.
     * </pre>
     */
    public void getSecretValue(ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.EnvironmentValue> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetSecretValueMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List environments with optional label filtering.
     * Secret values are redacted in the response.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public void list(ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.EnvironmentList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController handles read operations for environments.
   * </pre>
   */
  public static final class EnvironmentQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EnvironmentQueryControllerBlockingV2Stub> {
    private EnvironmentQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an environment by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the environment resource.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an environment by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/aws-prod" to the full Environment resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the unredacted value of a single secret key in an environment.
     * Returns the EnvironmentValue with the decrypted value for exactly one key.
     * &#64;internal
     * Creator-only: FGA authorization grants can_read_secrets via the creator relation.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.EnvironmentValue getSecretValue(ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetSecretValueMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List environments with optional label filtering.
     * Secret values are redacted in the response.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.EnvironmentList list(ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController handles read operations for environments.
   * </pre>
   */
  public static final class EnvironmentQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EnvironmentQueryControllerBlockingStub> {
    private EnvironmentQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an environment by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the environment resource.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an environment by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/aws-prod" to the full Environment resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.Environment getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get the unredacted value of a single secret key in an environment.
     * Returns the EnvironmentValue with the decrypted value for exactly one key.
     * &#64;internal
     * Creator-only: FGA authorization grants can_read_secrets via the creator relation.
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.EnvironmentValue getSecretValue(ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetSecretValueMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List environments with optional label filtering.
     * Secret values are redacted in the response.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.environment.v1.EnvironmentList list(ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EnvironmentQueryController.
   * <pre>
   * EnvironmentQueryController handles read operations for environments.
   * </pre>
   */
  public static final class EnvironmentQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EnvironmentQueryControllerFutureStub> {
    private EnvironmentQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EnvironmentQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EnvironmentQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an environment by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the environment resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an environment by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/aws-prod" to the full Environment resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.Environment> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get the unredacted value of a single secret key in an environment.
     * Returns the EnvironmentValue with the decrypted value for exactly one key.
     * &#64;internal
     * Creator-only: FGA authorization grants can_read_secrets via the creator relation.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.EnvironmentValue> getSecretValue(
        ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetSecretValueMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List environments with optional label filtering.
     * Secret values are redacted in the response.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.environment.v1.EnvironmentList> list(
        ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_GET_SECRET_VALUE = 2;
  private static final int METHODID_LIST = 3;

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
          serviceImpl.get((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.Environment>) responseObserver);
          break;
        case METHODID_GET_SECRET_VALUE:
          serviceImpl.getSecretValue((ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.EnvironmentValue>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.environment.v1.EnvironmentList>) responseObserver);
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
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.environment.v1.Environment>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getGetSecretValueMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.environment.v1.EnvironmentSecretValueInput,
              ai.stigmer.agentic.environment.v1.EnvironmentValue>(
                service, METHODID_GET_SECRET_VALUE)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.environment.v1.ListEnvironmentsRequest,
              ai.stigmer.agentic.environment.v1.EnvironmentList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class EnvironmentQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EnvironmentQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.environment.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EnvironmentQueryController");
    }
  }

  private static final class EnvironmentQueryControllerFileDescriptorSupplier
      extends EnvironmentQueryControllerBaseDescriptorSupplier {
    EnvironmentQueryControllerFileDescriptorSupplier() {}
  }

  private static final class EnvironmentQueryControllerMethodDescriptorSupplier
      extends EnvironmentQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EnvironmentQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EnvironmentQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EnvironmentQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getGetSecretValueMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
