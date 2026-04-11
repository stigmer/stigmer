package ai.stigmer.iam.oauthapp.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * OAuthAppCommandController provides write operations for OAuth app resources.
 * &#64;internal
 * OAuthApps hold vendor client credentials (client_secret) and are always
 * org-private. There is no updateVisibility RPC — public visibility is
 * intentionally unsupported to prevent credential leakage.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class OAuthAppCommandControllerGrpc {

  private OAuthAppCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.oauthapp.v1.OAuthAppCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.OAuthApp,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.iam.oauthapp.v1.OAuthApp.class,
      responseType = ai.stigmer.iam.oauthapp.v1.OAuthApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.OAuthApp,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.OAuthApp, ai.stigmer.iam.oauthapp.v1.OAuthApp> getApplyMethod;
    if ((getApplyMethod = OAuthAppCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (OAuthAppCommandControllerGrpc.class) {
        if ((getApplyMethod = OAuthAppCommandControllerGrpc.getApplyMethod) == null) {
          OAuthAppCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.oauthapp.v1.OAuthApp, ai.stigmer.iam.oauthapp.v1.OAuthApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApp.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApp.getDefaultInstance()))
              .setSchemaDescriptor(new OAuthAppCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.OAuthApp,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.oauthapp.v1.OAuthApp.class,
      responseType = ai.stigmer.iam.oauthapp.v1.OAuthApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.OAuthApp,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.OAuthApp, ai.stigmer.iam.oauthapp.v1.OAuthApp> getCreateMethod;
    if ((getCreateMethod = OAuthAppCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (OAuthAppCommandControllerGrpc.class) {
        if ((getCreateMethod = OAuthAppCommandControllerGrpc.getCreateMethod) == null) {
          OAuthAppCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.oauthapp.v1.OAuthApp, ai.stigmer.iam.oauthapp.v1.OAuthApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApp.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApp.getDefaultInstance()))
              .setSchemaDescriptor(new OAuthAppCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.OAuthApp,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.iam.oauthapp.v1.OAuthApp.class,
      responseType = ai.stigmer.iam.oauthapp.v1.OAuthApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.OAuthApp,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.oauthapp.v1.OAuthApp, ai.stigmer.iam.oauthapp.v1.OAuthApp> getUpdateMethod;
    if ((getUpdateMethod = OAuthAppCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (OAuthAppCommandControllerGrpc.class) {
        if ((getUpdateMethod = OAuthAppCommandControllerGrpc.getUpdateMethod) == null) {
          OAuthAppCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.oauthapp.v1.OAuthApp, ai.stigmer.iam.oauthapp.v1.OAuthApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApp.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApp.getDefaultInstance()))
              .setSchemaDescriptor(new OAuthAppCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.iam.oauthapp.v1.OAuthApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.iam.oauthapp.v1.OAuthApp> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.oauthapp.v1.OAuthApp> getDeleteMethod;
    if ((getDeleteMethod = OAuthAppCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (OAuthAppCommandControllerGrpc.class) {
        if ((getDeleteMethod = OAuthAppCommandControllerGrpc.getDeleteMethod) == null) {
          OAuthAppCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.iam.oauthapp.v1.OAuthApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.oauthapp.v1.OAuthApp.getDefaultInstance()))
              .setSchemaDescriptor(new OAuthAppCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static OAuthAppCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OAuthAppCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OAuthAppCommandControllerStub>() {
        @java.lang.Override
        public OAuthAppCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OAuthAppCommandControllerStub(channel, callOptions);
        }
      };
    return OAuthAppCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static OAuthAppCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OAuthAppCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OAuthAppCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public OAuthAppCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OAuthAppCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return OAuthAppCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static OAuthAppCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OAuthAppCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OAuthAppCommandControllerBlockingStub>() {
        @java.lang.Override
        public OAuthAppCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OAuthAppCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return OAuthAppCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static OAuthAppCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OAuthAppCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OAuthAppCommandControllerFutureStub>() {
        @java.lang.Override
        public OAuthAppCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OAuthAppCommandControllerFutureStub(channel, callOptions);
        }
      };
    return OAuthAppCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * OAuthAppCommandController provides write operations for OAuth app resources.
   * &#64;internal
   * OAuthApps hold vendor client credentials (client_secret) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an OAuth app.
     * If the resource does not exist, creates a new OAuth app.
     * If the resource exists, updates the existing OAuth app.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the
     * OAuth app is going to be created or updated, which is determined as
     * part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.iam.oauthapp.v1.OAuthApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an OAuth app.
     * The creator's organization owns the OAuth app. The creator is granted
     * the owner role automatically.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission in the organization.
     * </pre>
     */
    default void create(ai.stigmer.iam.oauthapp.v1.OAuthApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing OAuth app.
     * &#64;internal
     * Authorization: Requires can_edit permission on the oauth_app resource.
     * </pre>
     */
    default void update(ai.stigmer.iam.oauthapp.v1.OAuthApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an OAuth app.
     * Deletion should be blocked if any McpServer resources reference this
     * OAuth app via McpServerVendorOAuth.oauth_app_ref.
     * &#64;internal
     * Authorization: Requires can_delete permission on the oauth_app resource.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service OAuthAppCommandController.
   * <pre>
   * OAuthAppCommandController provides write operations for OAuth app resources.
   * &#64;internal
   * OAuthApps hold vendor client credentials (client_secret) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static abstract class OAuthAppCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return OAuthAppCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service OAuthAppCommandController.
   * <pre>
   * OAuthAppCommandController provides write operations for OAuth app resources.
   * &#64;internal
   * OAuthApps hold vendor client credentials (client_secret) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static final class OAuthAppCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<OAuthAppCommandControllerStub> {
    private OAuthAppCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OAuthAppCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OAuthAppCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an OAuth app.
     * If the resource does not exist, creates a new OAuth app.
     * If the resource exists, updates the existing OAuth app.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the
     * OAuth app is going to be created or updated, which is determined as
     * part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.iam.oauthapp.v1.OAuthApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an OAuth app.
     * The creator's organization owns the OAuth app. The creator is granted
     * the owner role automatically.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission in the organization.
     * </pre>
     */
    public void create(ai.stigmer.iam.oauthapp.v1.OAuthApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing OAuth app.
     * &#64;internal
     * Authorization: Requires can_edit permission on the oauth_app resource.
     * </pre>
     */
    public void update(ai.stigmer.iam.oauthapp.v1.OAuthApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an OAuth app.
     * Deletion should be blocked if any McpServer resources reference this
     * OAuth app via McpServerVendorOAuth.oauth_app_ref.
     * &#64;internal
     * Authorization: Requires can_delete permission on the oauth_app resource.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service OAuthAppCommandController.
   * <pre>
   * OAuthAppCommandController provides write operations for OAuth app resources.
   * &#64;internal
   * OAuthApps hold vendor client credentials (client_secret) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static final class OAuthAppCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<OAuthAppCommandControllerBlockingV2Stub> {
    private OAuthAppCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OAuthAppCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OAuthAppCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an OAuth app.
     * If the resource does not exist, creates a new OAuth app.
     * If the resource exists, updates the existing OAuth app.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the
     * OAuth app is going to be created or updated, which is determined as
     * part of the request execution.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp apply(ai.stigmer.iam.oauthapp.v1.OAuthApp request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an OAuth app.
     * The creator's organization owns the OAuth app. The creator is granted
     * the owner role automatically.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission in the organization.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp create(ai.stigmer.iam.oauthapp.v1.OAuthApp request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing OAuth app.
     * &#64;internal
     * Authorization: Requires can_edit permission on the oauth_app resource.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp update(ai.stigmer.iam.oauthapp.v1.OAuthApp request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an OAuth app.
     * Deletion should be blocked if any McpServer resources reference this
     * OAuth app via McpServerVendorOAuth.oauth_app_ref.
     * &#64;internal
     * Authorization: Requires can_delete permission on the oauth_app resource.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service OAuthAppCommandController.
   * <pre>
   * OAuthAppCommandController provides write operations for OAuth app resources.
   * &#64;internal
   * OAuthApps hold vendor client credentials (client_secret) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static final class OAuthAppCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<OAuthAppCommandControllerBlockingStub> {
    private OAuthAppCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OAuthAppCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OAuthAppCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an OAuth app.
     * If the resource does not exist, creates a new OAuth app.
     * If the resource exists, updates the existing OAuth app.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the
     * OAuth app is going to be created or updated, which is determined as
     * part of the request execution.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp apply(ai.stigmer.iam.oauthapp.v1.OAuthApp request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an OAuth app.
     * The creator's organization owns the OAuth app. The creator is granted
     * the owner role automatically.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission in the organization.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp create(ai.stigmer.iam.oauthapp.v1.OAuthApp request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing OAuth app.
     * &#64;internal
     * Authorization: Requires can_edit permission on the oauth_app resource.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp update(ai.stigmer.iam.oauthapp.v1.OAuthApp request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an OAuth app.
     * Deletion should be blocked if any McpServer resources reference this
     * OAuth app via McpServerVendorOAuth.oauth_app_ref.
     * &#64;internal
     * Authorization: Requires can_delete permission on the oauth_app resource.
     * </pre>
     */
    public ai.stigmer.iam.oauthapp.v1.OAuthApp delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service OAuthAppCommandController.
   * <pre>
   * OAuthAppCommandController provides write operations for OAuth app resources.
   * &#64;internal
   * OAuthApps hold vendor client credentials (client_secret) and are always
   * org-private. There is no updateVisibility RPC — public visibility is
   * intentionally unsupported to prevent credential leakage.
   * </pre>
   */
  public static final class OAuthAppCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<OAuthAppCommandControllerFutureStub> {
    private OAuthAppCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OAuthAppCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OAuthAppCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an OAuth app.
     * If the resource does not exist, creates a new OAuth app.
     * If the resource exists, updates the existing OAuth app.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the
     * OAuth app is going to be created or updated, which is determined as
     * part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.oauthapp.v1.OAuthApp> apply(
        ai.stigmer.iam.oauthapp.v1.OAuthApp request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an OAuth app.
     * The creator's organization owns the OAuth app. The creator is granted
     * the owner role automatically.
     * &#64;internal
     * Authorization: Requires can_create_oauth_app permission in the organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.oauthapp.v1.OAuthApp> create(
        ai.stigmer.iam.oauthapp.v1.OAuthApp request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing OAuth app.
     * &#64;internal
     * Authorization: Requires can_edit permission on the oauth_app resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.oauthapp.v1.OAuthApp> update(
        ai.stigmer.iam.oauthapp.v1.OAuthApp request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an OAuth app.
     * Deletion should be blocked if any McpServer resources reference this
     * OAuth app via McpServerVendorOAuth.oauth_app_ref.
     * &#64;internal
     * Authorization: Requires can_delete permission on the oauth_app resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.oauthapp.v1.OAuthApp> delete(
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
          serviceImpl.apply((ai.stigmer.iam.oauthapp.v1.OAuthApp) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.iam.oauthapp.v1.OAuthApp) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.iam.oauthapp.v1.OAuthApp) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.oauthapp.v1.OAuthApp>) responseObserver);
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
              ai.stigmer.iam.oauthapp.v1.OAuthApp,
              ai.stigmer.iam.oauthapp.v1.OAuthApp>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.oauthapp.v1.OAuthApp,
              ai.stigmer.iam.oauthapp.v1.OAuthApp>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.oauthapp.v1.OAuthApp,
              ai.stigmer.iam.oauthapp.v1.OAuthApp>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.iam.oauthapp.v1.OAuthApp>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class OAuthAppCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    OAuthAppCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.oauthapp.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("OAuthAppCommandController");
    }
  }

  private static final class OAuthAppCommandControllerFileDescriptorSupplier
      extends OAuthAppCommandControllerBaseDescriptorSupplier {
    OAuthAppCommandControllerFileDescriptorSupplier() {}
  }

  private static final class OAuthAppCommandControllerMethodDescriptorSupplier
      extends OAuthAppCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    OAuthAppCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (OAuthAppCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new OAuthAppCommandControllerFileDescriptorSupplier())
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
