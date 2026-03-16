package ai.stigmer.iam.identityprovider.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * IdentityProviderCommandController provides write operations for identity providers.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class IdentityProviderCommandControllerGrpc {

  private IdentityProviderCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.identityprovider.v1.IdentityProviderCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getApplyMethod;
    if ((getApplyMethod = IdentityProviderCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getApplyMethod = IdentityProviderCommandControllerGrpc.getApplyMethod) == null) {
          IdentityProviderCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getCreateMethod;
    if ((getCreateMethod = IdentityProviderCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getCreateMethod = IdentityProviderCommandControllerGrpc.getCreateMethod) == null) {
          IdentityProviderCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getUpdateMethod;
    if ((getUpdateMethod = IdentityProviderCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getUpdateMethod = IdentityProviderCommandControllerGrpc.getUpdateMethod) == null) {
          IdentityProviderCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.identityprovider.v1.IdentityProvider, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getDeleteMethod;
    if ((getDeleteMethod = IdentityProviderCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        if ((getDeleteMethod = IdentityProviderCommandControllerGrpc.getDeleteMethod) == null) {
          IdentityProviderCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static IdentityProviderCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerStub>() {
        @java.lang.Override
        public IdentityProviderCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderCommandControllerStub(channel, callOptions);
        }
      };
    return IdentityProviderCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static IdentityProviderCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public IdentityProviderCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return IdentityProviderCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static IdentityProviderCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerBlockingStub>() {
        @java.lang.Override
        public IdentityProviderCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return IdentityProviderCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static IdentityProviderCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderCommandControllerFutureStub>() {
        @java.lang.Override
        public IdentityProviderCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderCommandControllerFutureStub(channel, callOptions);
        }
      };
    return IdentityProviderCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an identity provider (Kubernetes-style apply).
     * If the resource doesn't exist: creates a new identity provider.
     * If the resource exists: updates the existing identity provider.
     * </pre>
     */
    default void apply(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new identity provider.
     * The creator's organization owns the identity provider.
     * </pre>
     */
    default void create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * Requires can_edit permission on the identity provider.
     * </pre>
     */
    default void update(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * Deletion is blocked if any platform-managed organizations reference this identity provider.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static abstract class IdentityProviderCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return IdentityProviderCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<IdentityProviderCommandControllerStub> {
    private IdentityProviderCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an identity provider (Kubernetes-style apply).
     * If the resource doesn't exist: creates a new identity provider.
     * If the resource exists: updates the existing identity provider.
     * </pre>
     */
    public void apply(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new identity provider.
     * The creator's organization owns the identity provider.
     * </pre>
     */
    public void create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * Requires can_edit permission on the identity provider.
     * </pre>
     */
    public void update(ai.stigmer.iam.identityprovider.v1.IdentityProvider request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * Deletion is blocked if any platform-managed organizations reference this identity provider.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<IdentityProviderCommandControllerBlockingV2Stub> {
    private IdentityProviderCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an identity provider (Kubernetes-style apply).
     * If the resource doesn't exist: creates a new identity provider.
     * If the resource exists: updates the existing identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider apply(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new identity provider.
     * The creator's organization owns the identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * Requires can_edit permission on the identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider update(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * Deletion is blocked if any platform-managed organizations reference this identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<IdentityProviderCommandControllerBlockingStub> {
    private IdentityProviderCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an identity provider (Kubernetes-style apply).
     * If the resource doesn't exist: creates a new identity provider.
     * If the resource exists: updates the existing identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider apply(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new identity provider.
     * The creator's organization owns the identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider create(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * Requires can_edit permission on the identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider update(ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * Deletion is blocked if any platform-managed organizations reference this identity provider.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service IdentityProviderCommandController.
   * <pre>
   * IdentityProviderCommandController provides write operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<IdentityProviderCommandControllerFutureStub> {
    private IdentityProviderCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an identity provider (Kubernetes-style apply).
     * If the resource doesn't exist: creates a new identity provider.
     * If the resource exists: updates the existing identity provider.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> apply(
        ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new identity provider.
     * The creator's organization owns the identity provider.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> create(
        ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing identity provider.
     * Requires can_edit permission on the identity provider.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> update(
        ai.stigmer.iam.identityprovider.v1.IdentityProvider request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an identity provider.
     * Deletion is blocked if any platform-managed organizations reference this identity provider.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> delete(
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
          serviceImpl.apply((ai.stigmer.iam.identityprovider.v1.IdentityProvider) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.iam.identityprovider.v1.IdentityProvider) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.iam.identityprovider.v1.IdentityProvider) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
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
              ai.stigmer.iam.identityprovider.v1.IdentityProvider,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityprovider.v1.IdentityProvider,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.identityprovider.v1.IdentityProvider,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class IdentityProviderCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    IdentityProviderCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.identityprovider.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("IdentityProviderCommandController");
    }
  }

  private static final class IdentityProviderCommandControllerFileDescriptorSupplier
      extends IdentityProviderCommandControllerBaseDescriptorSupplier {
    IdentityProviderCommandControllerFileDescriptorSupplier() {}
  }

  private static final class IdentityProviderCommandControllerMethodDescriptorSupplier
      extends IdentityProviderCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    IdentityProviderCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (IdentityProviderCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new IdentityProviderCommandControllerFileDescriptorSupplier())
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
