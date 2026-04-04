package ai.stigmer.iam.identityprovider.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * IdentityProviderQueryController provides read operations for identity providers.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class IdentityProviderQueryControllerGrpc {

  private IdentityProviderQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.identityprovider.v1.IdentityProviderQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetMethod;
    if ((getGetMethod = IdentityProviderQueryControllerGrpc.getGetMethod) == null) {
      synchronized (IdentityProviderQueryControllerGrpc.class) {
        if ((getGetMethod = IdentityProviderQueryControllerGrpc.getGetMethod) == null) {
          IdentityProviderQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.iam.identityprovider.v1.IdentityProvider.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.identityprovider.v1.IdentityProvider> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = IdentityProviderQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (IdentityProviderQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = IdentityProviderQueryControllerGrpc.getGetByReferenceMethod) == null) {
          IdentityProviderQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.identityprovider.v1.IdentityProvider>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.identityprovider.v1.IdentityProvider.getDefaultInstance()))
              .setSchemaDescriptor(new IdentityProviderQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static IdentityProviderQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerStub>() {
        @java.lang.Override
        public IdentityProviderQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderQueryControllerStub(channel, callOptions);
        }
      };
    return IdentityProviderQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static IdentityProviderQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public IdentityProviderQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return IdentityProviderQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static IdentityProviderQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerBlockingStub>() {
        @java.lang.Override
        public IdentityProviderQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return IdentityProviderQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static IdentityProviderQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IdentityProviderQueryControllerFutureStub>() {
        @java.lang.Override
        public IdentityProviderQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IdentityProviderQueryControllerFutureStub(channel, callOptions);
        }
      };
    return IdentityProviderQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton-cloud" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static abstract class IdentityProviderQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return IdentityProviderQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<IdentityProviderQueryControllerStub> {
    private IdentityProviderQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton-cloud" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<IdentityProviderQueryControllerBlockingV2Stub> {
    private IdentityProviderQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton-cloud" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<IdentityProviderQueryControllerBlockingStub> {
    private IdentityProviderQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton-cloud" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.iam.identityprovider.v1.IdentityProvider getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service IdentityProviderQueryController.
   * <pre>
   * IdentityProviderQueryController provides read operations for identity providers.
   * </pre>
   */
  public static final class IdentityProviderQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<IdentityProviderQueryControllerFutureStub> {
    private IdentityProviderQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IdentityProviderQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IdentityProviderQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an identity provider by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the identity provider resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an identity provider by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton-cloud" to the full
     * IdentityProvider resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.identityprovider.v1.IdentityProvider> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;

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
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.identityprovider.v1.IdentityProvider>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
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
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.iam.identityprovider.v1.IdentityProvider>(
                service, METHODID_GET_BY_REFERENCE)))
        .build();
  }

  private static abstract class IdentityProviderQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    IdentityProviderQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.identityprovider.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("IdentityProviderQueryController");
    }
  }

  private static final class IdentityProviderQueryControllerFileDescriptorSupplier
      extends IdentityProviderQueryControllerBaseDescriptorSupplier {
    IdentityProviderQueryControllerFileDescriptorSupplier() {}
  }

  private static final class IdentityProviderQueryControllerMethodDescriptorSupplier
      extends IdentityProviderQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    IdentityProviderQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (IdentityProviderQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new IdentityProviderQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .build();
        }
      }
    }
    return result;
  }
}
