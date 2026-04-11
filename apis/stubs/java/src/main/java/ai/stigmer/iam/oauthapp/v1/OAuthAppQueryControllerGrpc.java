package ai.stigmer.iam.oauthapp.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * OAuthAppQueryController provides read operations for OAuth app resources.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class OAuthAppQueryControllerGrpc {

  private OAuthAppQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.oauthapp.v1.OAuthAppQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.iam.oauthapp.v1.OAuthApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.oauthapp.v1.OAuthApp> getGetMethod;
    if ((getGetMethod = OAuthAppQueryControllerGrpc.getGetMethod) == null) {
      synchronized (OAuthAppQueryControllerGrpc.class) {
        if ((getGetMethod = OAuthAppQueryControllerGrpc.getGetMethod) == null) {
          OAuthAppQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.iam.oauthapp.v1.OAuthApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApp.getDefaultInstance()))
              .setSchemaDescriptor(new OAuthAppQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.iam.oauthapp.v1.OAuthApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.oauthapp.v1.OAuthApp> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = OAuthAppQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (OAuthAppQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = OAuthAppQueryControllerGrpc.getGetByReferenceMethod) == null) {
          OAuthAppQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.iam.oauthapp.v1.OAuthApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApp.getDefaultInstance()))
              .setSchemaDescriptor(new OAuthAppQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput,
      ai.stigmer.iam.oauthapp.v1.OAuthApps> getListByOrgMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByOrg",
      requestType = ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput.class,
      responseType = ai.stigmer.iam.oauthapp.v1.OAuthApps.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput,
      ai.stigmer.iam.oauthapp.v1.OAuthApps> getListByOrgMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput, ai.stigmer.iam.oauthapp.v1.OAuthApps> getListByOrgMethod;
    if ((getListByOrgMethod = OAuthAppQueryControllerGrpc.getListByOrgMethod) == null) {
      synchronized (OAuthAppQueryControllerGrpc.class) {
        if ((getListByOrgMethod = OAuthAppQueryControllerGrpc.getListByOrgMethod) == null) {
          OAuthAppQueryControllerGrpc.getListByOrgMethod = getListByOrgMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput, ai.stigmer.iam.oauthapp.v1.OAuthApps>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByOrg"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApps.getDefaultInstance()))
              .setSchemaDescriptor(new OAuthAppQueryControllerMethodDescriptorSupplier("listByOrg"))
              .build();
        }
      }
    }
    return getListByOrgMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static OAuthAppQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OAuthAppQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OAuthAppQueryControllerStub>() {
        @java.lang.Override
        public OAuthAppQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OAuthAppQueryControllerStub(channel, callOptions);
        }
      };
    return OAuthAppQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static OAuthAppQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OAuthAppQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OAuthAppQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public OAuthAppQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OAuthAppQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return OAuthAppQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static OAuthAppQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OAuthAppQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OAuthAppQueryControllerBlockingStub>() {
        @java.lang.Override
        public OAuthAppQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OAuthAppQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return OAuthAppQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static OAuthAppQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OAuthAppQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OAuthAppQueryControllerFutureStub>() {
        @java.lang.Override
        public OAuthAppQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OAuthAppQueryControllerFutureStub(channel, callOptions);
        }
      };
    return OAuthAppQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * OAuthAppQueryController provides read operations for OAuth app resources.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an OAuth app by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the oauth_app resource.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an OAuth app by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/slack-oauth" to the full
     * OAuthApp resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all OAuth apps belonging to an organization.
     * Returns every OAuthApp whose metadata.org matches the input org.
     * Typically a small set (1-5 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    default void listByOrg(ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApps> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByOrgMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service OAuthAppQueryController.
   * <pre>
   * OAuthAppQueryController provides read operations for OAuth app resources.
   * </pre>
   */
  public static abstract class OAuthAppQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return OAuthAppQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service OAuthAppQueryController.
   * <pre>
   * OAuthAppQueryController provides read operations for OAuth app resources.
   * </pre>
   */
  public static final class OAuthAppQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<OAuthAppQueryControllerStub> {
    private OAuthAppQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OAuthAppQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OAuthAppQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an OAuth app by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the oauth_app resource.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an OAuth app by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/slack-oauth" to the full
     * OAuthApp resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all OAuth apps belonging to an organization.
     * Returns every OAuthApp whose metadata.org matches the input org.
     * Typically a small set (1-5 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public void listByOrg(ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApps> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service OAuthAppQueryController.
   * <pre>
   * OAuthAppQueryController provides read operations for OAuth app resources.
   * </pre>
   */
  public static final class OAuthAppQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<OAuthAppQueryControllerBlockingV2Stub> {
    private OAuthAppQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OAuthAppQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OAuthAppQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an OAuth app by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the oauth_app resource.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an OAuth app by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/slack-oauth" to the full
     * OAuthApp resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all OAuth apps belonging to an organization.
     * Returns every OAuthApp whose metadata.org matches the input org.
     * Typically a small set (1-5 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApps listByOrg(ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service OAuthAppQueryController.
   * <pre>
   * OAuthAppQueryController provides read operations for OAuth app resources.
   * </pre>
   */
  public static final class OAuthAppQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<OAuthAppQueryControllerBlockingStub> {
    private OAuthAppQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OAuthAppQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OAuthAppQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an OAuth app by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the oauth_app resource.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an OAuth app by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/slack-oauth" to the full
     * OAuthApp resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all OAuth apps belonging to an organization.
     * Returns every OAuthApp whose metadata.org matches the input org.
     * Typically a small set (1-5 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApps listByOrg(ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service OAuthAppQueryController.
   * <pre>
   * OAuthAppQueryController provides read operations for OAuth app resources.
   * </pre>
   */
  public static final class OAuthAppQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<OAuthAppQueryControllerFutureStub> {
    private OAuthAppQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OAuthAppQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OAuthAppQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an OAuth app by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the oauth_app resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.oauthapp.v1.OAuthApp> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an OAuth app by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/slack-oauth" to the full
     * OAuthApp resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.oauthapp.v1.OAuthApp> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all OAuth apps belonging to an organization.
     * Returns every OAuthApp whose metadata.org matches the input org.
     * Typically a small set (1-5 per org), so results are not paginated.
     * &#64;internal
     * Authorization: Requires can_view permission on the organization resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.oauthapp.v1.OAuthApps> listByOrg(
        ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput request) {
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
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp>) responseObserver);
          break;
        case METHODID_LIST_BY_ORG:
          serviceImpl.listByOrg((ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApps>) responseObserver);
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
              ai.stigmer.iam.oauthapp.v1.OAuthApp>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.iam.oauthapp.v1.OAuthApp>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListByOrgMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.oauthapp.v1.ListOAuthAppsByOrgInput,
              ai.stigmer.iam.oauthapp.v1.OAuthApps>(
                service, METHODID_LIST_BY_ORG)))
        .build();
  }

  private static abstract class OAuthAppQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    OAuthAppQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.oauthapp.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("OAuthAppQueryController");
    }
  }

  private static final class OAuthAppQueryControllerFileDescriptorSupplier
      extends OAuthAppQueryControllerBaseDescriptorSupplier {
    OAuthAppQueryControllerFileDescriptorSupplier() {}
  }

  private static final class OAuthAppQueryControllerMethodDescriptorSupplier
      extends OAuthAppQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    OAuthAppQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (OAuthAppQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new OAuthAppQueryControllerFileDescriptorSupplier())
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
