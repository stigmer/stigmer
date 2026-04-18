package ai.stigmer.iam.platformclient.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * PlatformClientQueryController provides read operations for platform client resources.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PlatformClientQueryControllerGrpc {

  private PlatformClientQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.platformclient.v1.PlatformClientQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.platformclient.v1.PlatformClient> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.iam.platformclient.v1.PlatformClient.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.platformclient.v1.PlatformClient> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.platformclient.v1.PlatformClient> getGetMethod;
    if ((getGetMethod = PlatformClientQueryControllerGrpc.getGetMethod) == null) {
      synchronized (PlatformClientQueryControllerGrpc.class) {
        if ((getGetMethod = PlatformClientQueryControllerGrpc.getGetMethod) == null) {
          PlatformClientQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.platformclient.v1.PlatformClient>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClient.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformClientQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.platformclient.v1.PlatformClient> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.iam.platformclient.v1.PlatformClient.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.platformclient.v1.PlatformClient> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.platformclient.v1.PlatformClient> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = PlatformClientQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (PlatformClientQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = PlatformClientQueryControllerGrpc.getGetByReferenceMethod) == null) {
          PlatformClientQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.platformclient.v1.PlatformClient>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClient.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformClientQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput,
      ai.stigmer.iam.platformclient.v1.PlatformClients> getListByOrgMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByOrg",
      requestType = ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput.class,
      responseType = ai.stigmer.iam.platformclient.v1.PlatformClients.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput,
      ai.stigmer.iam.platformclient.v1.PlatformClients> getListByOrgMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput, ai.stigmer.iam.platformclient.v1.PlatformClients> getListByOrgMethod;
    if ((getListByOrgMethod = PlatformClientQueryControllerGrpc.getListByOrgMethod) == null) {
      synchronized (PlatformClientQueryControllerGrpc.class) {
        if ((getListByOrgMethod = PlatformClientQueryControllerGrpc.getListByOrgMethod) == null) {
          PlatformClientQueryControllerGrpc.getListByOrgMethod = getListByOrgMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput, ai.stigmer.iam.platformclient.v1.PlatformClients>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByOrg"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.platformclient.v1.PlatformClients.getDefaultInstance()))
              .setSchemaDescriptor(new PlatformClientQueryControllerMethodDescriptorSupplier("listByOrg"))
              .build();
        }
      }
    }
    return getListByOrgMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PlatformClientQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientQueryControllerStub>() {
        @java.lang.Override
        public PlatformClientQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientQueryControllerStub(channel, callOptions);
        }
      };
    return PlatformClientQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PlatformClientQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public PlatformClientQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PlatformClientQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PlatformClientQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientQueryControllerBlockingStub>() {
        @java.lang.Override
        public PlatformClientQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return PlatformClientQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PlatformClientQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlatformClientQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlatformClientQueryControllerFutureStub>() {
        @java.lang.Override
        public PlatformClientQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlatformClientQueryControllerFutureStub(channel, callOptions);
        }
      };
    return PlatformClientQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * PlatformClientQueryController provides read operations for platform client resources.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a platform client by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the platform client resource.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a platform client by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/acme-dashboard" to the full
     * PlatformClient resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all platform clients belonging to an organization.
     * Returns every PlatformClient whose metadata.org matches the input org.
     * Typically a small set per org, so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    default void listByOrg(ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClients> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByOrgMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PlatformClientQueryController.
   * <pre>
   * PlatformClientQueryController provides read operations for platform client resources.
   * </pre>
   */
  public static abstract class PlatformClientQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PlatformClientQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PlatformClientQueryController.
   * <pre>
   * PlatformClientQueryController provides read operations for platform client resources.
   * </pre>
   */
  public static final class PlatformClientQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PlatformClientQueryControllerStub> {
    private PlatformClientQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a platform client by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the platform client resource.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a platform client by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/acme-dashboard" to the full
     * PlatformClient resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all platform clients belonging to an organization.
     * Returns every PlatformClient whose metadata.org matches the input org.
     * Typically a small set per org, so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public void listByOrg(ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClients> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PlatformClientQueryController.
   * <pre>
   * PlatformClientQueryController provides read operations for platform client resources.
   * </pre>
   */
  public static final class PlatformClientQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PlatformClientQueryControllerBlockingV2Stub> {
    private PlatformClientQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a platform client by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the platform client resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClient get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a platform client by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/acme-dashboard" to the full
     * PlatformClient resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClient getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all platform clients belonging to an organization.
     * Returns every PlatformClient whose metadata.org matches the input org.
     * Typically a small set per org, so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClients listByOrg(ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PlatformClientQueryController.
   * <pre>
   * PlatformClientQueryController provides read operations for platform client resources.
   * </pre>
   */
  public static final class PlatformClientQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PlatformClientQueryControllerBlockingStub> {
    private PlatformClientQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a platform client by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the platform client resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClient get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a platform client by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/acme-dashboard" to the full
     * PlatformClient resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClient getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all platform clients belonging to an organization.
     * Returns every PlatformClient whose metadata.org matches the input org.
     * Typically a small set per org, so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public ai.stigmer.iam.platformclient.v1.PlatformClients listByOrg(ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PlatformClientQueryController.
   * <pre>
   * PlatformClientQueryController provides read operations for platform client resources.
   * </pre>
   */
  public static final class PlatformClientQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PlatformClientQueryControllerFutureStub> {
    private PlatformClientQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlatformClientQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlatformClientQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a platform client by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the platform client resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.platformclient.v1.PlatformClient> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a platform client by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/acme-dashboard" to the full
     * PlatformClient resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.platformclient.v1.PlatformClient> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all platform clients belonging to an organization.
     * Returns every PlatformClient whose metadata.org matches the input org.
     * Typically a small set per org, so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.platformclient.v1.PlatformClients> listByOrg(
        ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST_BY_ORG = 2;

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
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClient>) responseObserver);
          break;
        case METHODID_LIST_BY_ORG:
          serviceImpl.listByOrg((ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.platformclient.v1.PlatformClients>) responseObserver);
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
              ai.stigmer.iam.platformclient.v1.PlatformClient>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.iam.platformclient.v1.PlatformClient>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListByOrgMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.platformclient.v1.ListPlatformClientsByOrgInput,
              ai.stigmer.iam.platformclient.v1.PlatformClients>(
                service, METHODID_LIST_BY_ORG)))
        .build();
  }

  private static abstract class PlatformClientQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PlatformClientQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.platformclient.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PlatformClientQueryController");
    }
  }

  private static final class PlatformClientQueryControllerFileDescriptorSupplier
      extends PlatformClientQueryControllerBaseDescriptorSupplier {
    PlatformClientQueryControllerFileDescriptorSupplier() {}
  }

  private static final class PlatformClientQueryControllerMethodDescriptorSupplier
      extends PlatformClientQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PlatformClientQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PlatformClientQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PlatformClientQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListByOrgMethod())
              .build();
        }
      }
    }
    return result;
  }
}
