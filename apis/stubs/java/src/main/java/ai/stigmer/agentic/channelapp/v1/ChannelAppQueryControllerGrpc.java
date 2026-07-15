package ai.stigmer.agentic.channelapp.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ChannelAppQueryController handles read operations for channel apps.
 * &#64;internal
 * Every response passes through secret redaction — client_secret and
 * signing_secret are replaced with the redaction marker. Runtime
 * consumers that need the real values (installer, webhook receiver)
 * read the repo directly, the documented OAuthAppResolutionService
 * exception.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ChannelAppQueryControllerGrpc {

  private ChannelAppQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.channelapp.v1.ChannelAppQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.channelapp.v1.ChannelApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.channelapp.v1.ChannelApp> getGetMethod;
    if ((getGetMethod = ChannelAppQueryControllerGrpc.getGetMethod) == null) {
      synchronized (ChannelAppQueryControllerGrpc.class) {
        if ((getGetMethod = ChannelAppQueryControllerGrpc.getGetMethod) == null) {
          ChannelAppQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.channelapp.v1.ChannelApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApp.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelAppQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.channelapp.v1.ChannelApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.channelapp.v1.ChannelApp> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = ChannelAppQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (ChannelAppQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = ChannelAppQueryControllerGrpc.getGetByReferenceMethod) == null) {
          ChannelAppQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.channelapp.v1.ChannelApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApp.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelAppQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput,
      ai.stigmer.agentic.channelapp.v1.ChannelApps> getListByOrgMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByOrg",
      requestType = ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput.class,
      responseType = ai.stigmer.agentic.channelapp.v1.ChannelApps.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput,
      ai.stigmer.agentic.channelapp.v1.ChannelApps> getListByOrgMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput, ai.stigmer.agentic.channelapp.v1.ChannelApps> getListByOrgMethod;
    if ((getListByOrgMethod = ChannelAppQueryControllerGrpc.getListByOrgMethod) == null) {
      synchronized (ChannelAppQueryControllerGrpc.class) {
        if ((getListByOrgMethod = ChannelAppQueryControllerGrpc.getListByOrgMethod) == null) {
          ChannelAppQueryControllerGrpc.getListByOrgMethod = getListByOrgMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput, ai.stigmer.agentic.channelapp.v1.ChannelApps>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByOrg"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApps.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelAppQueryControllerMethodDescriptorSupplier("listByOrg"))
              .build();
        }
      }
    }
    return getListByOrgMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ChannelAppQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelAppQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelAppQueryControllerStub>() {
        @java.lang.Override
        public ChannelAppQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelAppQueryControllerStub(channel, callOptions);
        }
      };
    return ChannelAppQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ChannelAppQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelAppQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelAppQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ChannelAppQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelAppQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ChannelAppQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ChannelAppQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelAppQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelAppQueryControllerBlockingStub>() {
        @java.lang.Override
        public ChannelAppQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelAppQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ChannelAppQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ChannelAppQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelAppQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelAppQueryControllerFutureStub>() {
        @java.lang.Override
        public ChannelAppQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelAppQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ChannelAppQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ChannelAppQueryController handles read operations for channel apps.
   * &#64;internal
   * Every response passes through secret redaction — client_secret and
   * signing_secret are replaced with the redaction marker. Runtime
   * consumers that need the real values (installer, webhook receiver)
   * read the repo directly, the documented OAuthAppResolutionService
   * exception.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a channel app by its unique identifier.
     * Secret fields are redacted in the response.
     * &#64;internal
     * Authorization: requires can_view permission on the channel_app
     * resource.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a channel app by its organization-scoped reference (org/slug).
     * Secret fields are redacted in the response.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the OAuthApp pattern).
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all channel apps belonging to an organization.
     * Returns every ChannelApp whose metadata.org matches the input org,
     * with secret fields redacted. Typically a small set, so results are
     * not paginated.
     * &#64;internal
     * Authorization: requires can_view permission on the organization
     * resource.
     * </pre>
     */
    default void listByOrg(ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApps> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByOrgMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ChannelAppQueryController.
   * <pre>
   * ChannelAppQueryController handles read operations for channel apps.
   * &#64;internal
   * Every response passes through secret redaction — client_secret and
   * signing_secret are replaced with the redaction marker. Runtime
   * consumers that need the real values (installer, webhook receiver)
   * read the repo directly, the documented OAuthAppResolutionService
   * exception.
   * </pre>
   */
  public static abstract class ChannelAppQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ChannelAppQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ChannelAppQueryController.
   * <pre>
   * ChannelAppQueryController handles read operations for channel apps.
   * &#64;internal
   * Every response passes through secret redaction — client_secret and
   * signing_secret are replaced with the redaction marker. Runtime
   * consumers that need the real values (installer, webhook receiver)
   * read the repo directly, the documented OAuthAppResolutionService
   * exception.
   * </pre>
   */
  public static final class ChannelAppQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ChannelAppQueryControllerStub> {
    private ChannelAppQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelAppQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelAppQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a channel app by its unique identifier.
     * Secret fields are redacted in the response.
     * &#64;internal
     * Authorization: requires can_view permission on the channel_app
     * resource.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a channel app by its organization-scoped reference (org/slug).
     * Secret fields are redacted in the response.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the OAuthApp pattern).
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all channel apps belonging to an organization.
     * Returns every ChannelApp whose metadata.org matches the input org,
     * with secret fields redacted. Typically a small set, so results are
     * not paginated.
     * &#64;internal
     * Authorization: requires can_view permission on the organization
     * resource.
     * </pre>
     */
    public void listByOrg(ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApps> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByOrgMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ChannelAppQueryController.
   * <pre>
   * ChannelAppQueryController handles read operations for channel apps.
   * &#64;internal
   * Every response passes through secret redaction — client_secret and
   * signing_secret are replaced with the redaction marker. Runtime
   * consumers that need the real values (installer, webhook receiver)
   * read the repo directly, the documented OAuthAppResolutionService
   * exception.
   * </pre>
   */
  public static final class ChannelAppQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ChannelAppQueryControllerBlockingV2Stub> {
    private ChannelAppQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelAppQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelAppQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a channel app by its unique identifier.
     * Secret fields are redacted in the response.
     * &#64;internal
     * Authorization: requires can_view permission on the channel_app
     * resource.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a channel app by its organization-scoped reference (org/slug).
     * Secret fields are redacted in the response.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the OAuthApp pattern).
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all channel apps belonging to an organization.
     * Returns every ChannelApp whose metadata.org matches the input org,
     * with secret fields redacted. Typically a small set, so results are
     * not paginated.
     * &#64;internal
     * Authorization: requires can_view permission on the organization
     * resource.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApps listByOrg(ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ChannelAppQueryController.
   * <pre>
   * ChannelAppQueryController handles read operations for channel apps.
   * &#64;internal
   * Every response passes through secret redaction — client_secret and
   * signing_secret are replaced with the redaction marker. Runtime
   * consumers that need the real values (installer, webhook receiver)
   * read the repo directly, the documented OAuthAppResolutionService
   * exception.
   * </pre>
   */
  public static final class ChannelAppQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ChannelAppQueryControllerBlockingStub> {
    private ChannelAppQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelAppQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelAppQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a channel app by its unique identifier.
     * Secret fields are redacted in the response.
     * &#64;internal
     * Authorization: requires can_view permission on the channel_app
     * resource.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a channel app by its organization-scoped reference (org/slug).
     * Secret fields are redacted in the response.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the OAuthApp pattern).
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all channel apps belonging to an organization.
     * Returns every ChannelApp whose metadata.org matches the input org,
     * with secret fields redacted. Typically a small set, so results are
     * not paginated.
     * &#64;internal
     * Authorization: requires can_view permission on the organization
     * resource.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApps listByOrg(ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByOrgMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ChannelAppQueryController.
   * <pre>
   * ChannelAppQueryController handles read operations for channel apps.
   * &#64;internal
   * Every response passes through secret redaction — client_secret and
   * signing_secret are replaced with the redaction marker. Runtime
   * consumers that need the real values (installer, webhook receiver)
   * read the repo directly, the documented OAuthAppResolutionService
   * exception.
   * </pre>
   */
  public static final class ChannelAppQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ChannelAppQueryControllerFutureStub> {
    private ChannelAppQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelAppQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelAppQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a channel app by its unique identifier.
     * Secret fields are redacted in the response.
     * &#64;internal
     * Authorization: requires can_view permission on the channel_app
     * resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channelapp.v1.ChannelApp> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a channel app by its organization-scoped reference (org/slug).
     * Secret fields are redacted in the response.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the OAuthApp pattern).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channelapp.v1.ChannelApp> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all channel apps belonging to an organization.
     * Returns every ChannelApp whose metadata.org matches the input org,
     * with secret fields redacted. Typically a small set, so results are
     * not paginated.
     * &#64;internal
     * Authorization: requires can_view permission on the organization
     * resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channelapp.v1.ChannelApps> listByOrg(
        ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput request) {
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
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp>) responseObserver);
          break;
        case METHODID_LIST_BY_ORG:
          serviceImpl.listByOrg((ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApps>) responseObserver);
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
              ai.stigmer.agentic.channelapp.v1.ChannelApp>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.channelapp.v1.ChannelApp>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListByOrgMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channelapp.v1.ListChannelAppsByOrgInput,
              ai.stigmer.agentic.channelapp.v1.ChannelApps>(
                service, METHODID_LIST_BY_ORG)))
        .build();
  }

  private static abstract class ChannelAppQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ChannelAppQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.channelapp.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ChannelAppQueryController");
    }
  }

  private static final class ChannelAppQueryControllerFileDescriptorSupplier
      extends ChannelAppQueryControllerBaseDescriptorSupplier {
    ChannelAppQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ChannelAppQueryControllerMethodDescriptorSupplier
      extends ChannelAppQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ChannelAppQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ChannelAppQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ChannelAppQueryControllerFileDescriptorSupplier())
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
