package ai.stigmer.iam.federationissuer.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * FederationIssuerQueryController provides read operations for federation issuers.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class FederationIssuerQueryControllerGrpc {

  private FederationIssuerQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.federationissuer.v1.FederationIssuerQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.iam.federationissuer.v1.FederationIssuer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.federationissuer.v1.FederationIssuer> getGetMethod;
    if ((getGetMethod = FederationIssuerQueryControllerGrpc.getGetMethod) == null) {
      synchronized (FederationIssuerQueryControllerGrpc.class) {
        if ((getGetMethod = FederationIssuerQueryControllerGrpc.getGetMethod) == null) {
          FederationIssuerQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.federationissuer.v1.FederationIssuer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuer.getDefaultInstance()))
              .setSchemaDescriptor(new FederationIssuerQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.iam.federationissuer.v1.FederationIssuer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.federationissuer.v1.FederationIssuer> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.federationissuer.v1.FederationIssuer> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = FederationIssuerQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (FederationIssuerQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = FederationIssuerQueryControllerGrpc.getGetByReferenceMethod) == null) {
          FederationIssuerQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.federationissuer.v1.FederationIssuer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuer.getDefaultInstance()))
              .setSchemaDescriptor(new FederationIssuerQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput,
      ai.stigmer.iam.federationissuer.v1.FederationIssuers> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput.class,
      responseType = ai.stigmer.iam.federationissuer.v1.FederationIssuers.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput,
      ai.stigmer.iam.federationissuer.v1.FederationIssuers> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput, ai.stigmer.iam.federationissuer.v1.FederationIssuers> getListMethod;
    if ((getListMethod = FederationIssuerQueryControllerGrpc.getListMethod) == null) {
      synchronized (FederationIssuerQueryControllerGrpc.class) {
        if ((getListMethod = FederationIssuerQueryControllerGrpc.getListMethod) == null) {
          FederationIssuerQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput, ai.stigmer.iam.federationissuer.v1.FederationIssuers>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.federationissuer.v1.FederationIssuers.getDefaultInstance()))
              .setSchemaDescriptor(new FederationIssuerQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static FederationIssuerQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FederationIssuerQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FederationIssuerQueryControllerStub>() {
        @java.lang.Override
        public FederationIssuerQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FederationIssuerQueryControllerStub(channel, callOptions);
        }
      };
    return FederationIssuerQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static FederationIssuerQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FederationIssuerQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FederationIssuerQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public FederationIssuerQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FederationIssuerQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return FederationIssuerQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static FederationIssuerQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FederationIssuerQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FederationIssuerQueryControllerBlockingStub>() {
        @java.lang.Override
        public FederationIssuerQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FederationIssuerQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return FederationIssuerQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static FederationIssuerQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<FederationIssuerQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<FederationIssuerQueryControllerFutureStub>() {
        @java.lang.Override
        public FederationIssuerQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new FederationIssuerQueryControllerFutureStub(channel, callOptions);
        }
      };
    return FederationIssuerQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * FederationIssuerQueryController provides read operations for federation issuers.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a federation issuer by its unique identifier.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a federation issuer by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * FederationIssuer resource.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the federation issuers of an organization that the caller may view.
     * Returns the FederationIssuers whose metadata.org matches the input org and
     * that the caller could get by id, newest first, one page at a time.
     * </pre>
     */
    default void list(ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuers> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service FederationIssuerQueryController.
   * <pre>
   * FederationIssuerQueryController provides read operations for federation issuers.
   * </pre>
   */
  public static abstract class FederationIssuerQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return FederationIssuerQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service FederationIssuerQueryController.
   * <pre>
   * FederationIssuerQueryController provides read operations for federation issuers.
   * </pre>
   */
  public static final class FederationIssuerQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<FederationIssuerQueryControllerStub> {
    private FederationIssuerQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FederationIssuerQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FederationIssuerQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a federation issuer by its unique identifier.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a federation issuer by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * FederationIssuer resource.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the federation issuers of an organization that the caller may view.
     * Returns the FederationIssuers whose metadata.org matches the input org and
     * that the caller could get by id, newest first, one page at a time.
     * </pre>
     */
    public void list(ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuers> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service FederationIssuerQueryController.
   * <pre>
   * FederationIssuerQueryController provides read operations for federation issuers.
   * </pre>
   */
  public static final class FederationIssuerQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<FederationIssuerQueryControllerBlockingV2Stub> {
    private FederationIssuerQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FederationIssuerQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FederationIssuerQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a federation issuer by its unique identifier.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a federation issuer by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * FederationIssuer resource.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the federation issuers of an organization that the caller may view.
     * Returns the FederationIssuers whose metadata.org matches the input org and
     * that the caller could get by id, newest first, one page at a time.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuers list(ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service FederationIssuerQueryController.
   * <pre>
   * FederationIssuerQueryController provides read operations for federation issuers.
   * </pre>
   */
  public static final class FederationIssuerQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<FederationIssuerQueryControllerBlockingStub> {
    private FederationIssuerQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FederationIssuerQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FederationIssuerQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a federation issuer by its unique identifier.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a federation issuer by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * FederationIssuer resource.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuer getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the federation issuers of an organization that the caller may view.
     * Returns the FederationIssuers whose metadata.org matches the input org and
     * that the caller could get by id, newest first, one page at a time.
     * </pre>
     */
    public ai.stigmer.iam.federationissuer.v1.FederationIssuers list(ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service FederationIssuerQueryController.
   * <pre>
   * FederationIssuerQueryController provides read operations for federation issuers.
   * </pre>
   */
  public static final class FederationIssuerQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<FederationIssuerQueryControllerFutureStub> {
    private FederationIssuerQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected FederationIssuerQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new FederationIssuerQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a federation issuer by its unique identifier.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.federationissuer.v1.FederationIssuer> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a federation issuer by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/planton" to the full
     * FederationIssuer resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.federationissuer.v1.FederationIssuer> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the federation issuers of an organization that the caller may view.
     * Returns the FederationIssuers whose metadata.org matches the input org and
     * that the caller could get by id, newest first, one page at a time.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.federationissuer.v1.FederationIssuers> list(
        ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST = 2;

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
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuer>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.federationissuer.v1.FederationIssuers>) responseObserver);
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
              ai.stigmer.iam.federationissuer.v1.FederationIssuer>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.iam.federationissuer.v1.FederationIssuer>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.federationissuer.v1.ListFederationIssuersInput,
              ai.stigmer.iam.federationissuer.v1.FederationIssuers>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class FederationIssuerQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    FederationIssuerQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.federationissuer.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("FederationIssuerQueryController");
    }
  }

  private static final class FederationIssuerQueryControllerFileDescriptorSupplier
      extends FederationIssuerQueryControllerBaseDescriptorSupplier {
    FederationIssuerQueryControllerFileDescriptorSupplier() {}
  }

  private static final class FederationIssuerQueryControllerMethodDescriptorSupplier
      extends FederationIssuerQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    FederationIssuerQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (FederationIssuerQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new FederationIssuerQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
