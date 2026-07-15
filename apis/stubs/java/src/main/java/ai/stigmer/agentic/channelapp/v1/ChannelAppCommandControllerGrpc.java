package ai.stigmer.agentic.channelapp.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ChannelAppCommandController handles write operations for channel apps.
 * &#64;internal
 * ChannelApps hold provider secrets (client_secret, signing_secret) and
 * are always org-private. There is no updateVisibility RPC — public
 * visibility is intentionally unsupported to prevent credential leakage
 * (the OAuthApp posture).
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ChannelAppCommandControllerGrpc {

  private ChannelAppCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.channelapp.v1.ChannelAppCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ChannelApp,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.channelapp.v1.ChannelApp.class,
      responseType = ai.stigmer.agentic.channelapp.v1.ChannelApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ChannelApp,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ChannelApp, ai.stigmer.agentic.channelapp.v1.ChannelApp> getApplyMethod;
    if ((getApplyMethod = ChannelAppCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (ChannelAppCommandControllerGrpc.class) {
        if ((getApplyMethod = ChannelAppCommandControllerGrpc.getApplyMethod) == null) {
          ChannelAppCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channelapp.v1.ChannelApp, ai.stigmer.agentic.channelapp.v1.ChannelApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApp.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApp.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelAppCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ChannelApp,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.channelapp.v1.ChannelApp.class,
      responseType = ai.stigmer.agentic.channelapp.v1.ChannelApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ChannelApp,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ChannelApp, ai.stigmer.agentic.channelapp.v1.ChannelApp> getCreateMethod;
    if ((getCreateMethod = ChannelAppCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (ChannelAppCommandControllerGrpc.class) {
        if ((getCreateMethod = ChannelAppCommandControllerGrpc.getCreateMethod) == null) {
          ChannelAppCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channelapp.v1.ChannelApp, ai.stigmer.agentic.channelapp.v1.ChannelApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApp.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApp.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelAppCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ChannelApp,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.channelapp.v1.ChannelApp.class,
      responseType = ai.stigmer.agentic.channelapp.v1.ChannelApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ChannelApp,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.channelapp.v1.ChannelApp, ai.stigmer.agentic.channelapp.v1.ChannelApp> getUpdateMethod;
    if ((getUpdateMethod = ChannelAppCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (ChannelAppCommandControllerGrpc.class) {
        if ((getUpdateMethod = ChannelAppCommandControllerGrpc.getUpdateMethod) == null) {
          ChannelAppCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.channelapp.v1.ChannelApp, ai.stigmer.agentic.channelapp.v1.ChannelApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApp.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApp.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelAppCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.agentic.channelapp.v1.ChannelApp.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.channelapp.v1.ChannelApp> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.channelapp.v1.ChannelApp> getDeleteMethod;
    if ((getDeleteMethod = ChannelAppCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ChannelAppCommandControllerGrpc.class) {
        if ((getDeleteMethod = ChannelAppCommandControllerGrpc.getDeleteMethod) == null) {
          ChannelAppCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.channelapp.v1.ChannelApp>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.channelapp.v1.ChannelApp.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelAppCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ChannelAppCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelAppCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelAppCommandControllerStub>() {
        @java.lang.Override
        public ChannelAppCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelAppCommandControllerStub(channel, callOptions);
        }
      };
    return ChannelAppCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ChannelAppCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelAppCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelAppCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ChannelAppCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelAppCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ChannelAppCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ChannelAppCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelAppCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelAppCommandControllerBlockingStub>() {
        @java.lang.Override
        public ChannelAppCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelAppCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ChannelAppCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ChannelAppCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelAppCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelAppCommandControllerFutureStub>() {
        @java.lang.Override
        public ChannelAppCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelAppCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ChannelAppCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ChannelAppCommandController handles write operations for channel apps.
   * &#64;internal
   * ChannelApps hold provider secrets (client_secret, signing_secret) and
   * are always org-private. There is no updateVisibility RPC — public
   * visibility is intentionally unsupported to prevent credential leakage
   * (the OAuthApp posture).
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a channel app.
     * If the resource does not exist, creates a new channel app.
     * If the resource exists, updates the existing channel app. Sending
     * the redaction marker for a secret field preserves the stored value.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel app is going to be created or updated, resolved
     * as part of request execution.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.channelapp.v1.ChannelApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a channel app.
     * The creator's organization owns the channel app. The creator is
     * granted the owner role automatically.
     * &#64;internal
     * Authorization: requires can_create_channel_app permission in the
     * organization (admin-gated like can_create_oauth_app — the resource
     * holds org-wide webhook credentials).
     * </pre>
     */
    default void create(ai.stigmer.agentic.channelapp.v1.ChannelApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing channel app.
     * Sending the redaction marker for a secret field preserves the
     * stored value; the provider arm is immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the channel_app
     * resource.
     * </pre>
     */
    default void update(ai.stigmer.agentic.channelapp.v1.ChannelApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a channel app.
     * Deletion is blocked while any AgentChannel references this app via
     * spec.app_ref — disconnect or delete those channels first.
     * &#64;internal
     * Authorization: requires can_delete permission on the channel_app
     * resource. The referencing-channels block mirrors OAuthApp's
     * referencing-mcp-servers check and fails with FAILED_PRECONDITION
     * naming a referencing channel.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ChannelAppCommandController.
   * <pre>
   * ChannelAppCommandController handles write operations for channel apps.
   * &#64;internal
   * ChannelApps hold provider secrets (client_secret, signing_secret) and
   * are always org-private. There is no updateVisibility RPC — public
   * visibility is intentionally unsupported to prevent credential leakage
   * (the OAuthApp posture).
   * </pre>
   */
  public static abstract class ChannelAppCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ChannelAppCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ChannelAppCommandController.
   * <pre>
   * ChannelAppCommandController handles write operations for channel apps.
   * &#64;internal
   * ChannelApps hold provider secrets (client_secret, signing_secret) and
   * are always org-private. There is no updateVisibility RPC — public
   * visibility is intentionally unsupported to prevent credential leakage
   * (the OAuthApp posture).
   * </pre>
   */
  public static final class ChannelAppCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ChannelAppCommandControllerStub> {
    private ChannelAppCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelAppCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelAppCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a channel app.
     * If the resource does not exist, creates a new channel app.
     * If the resource exists, updates the existing channel app. Sending
     * the redaction marker for a secret field preserves the stored value.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel app is going to be created or updated, resolved
     * as part of request execution.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.channelapp.v1.ChannelApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a channel app.
     * The creator's organization owns the channel app. The creator is
     * granted the owner role automatically.
     * &#64;internal
     * Authorization: requires can_create_channel_app permission in the
     * organization (admin-gated like can_create_oauth_app — the resource
     * holds org-wide webhook credentials).
     * </pre>
     */
    public void create(ai.stigmer.agentic.channelapp.v1.ChannelApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing channel app.
     * Sending the redaction marker for a secret field preserves the
     * stored value; the provider arm is immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the channel_app
     * resource.
     * </pre>
     */
    public void update(ai.stigmer.agentic.channelapp.v1.ChannelApp request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a channel app.
     * Deletion is blocked while any AgentChannel references this app via
     * spec.app_ref — disconnect or delete those channels first.
     * &#64;internal
     * Authorization: requires can_delete permission on the channel_app
     * resource. The referencing-channels block mirrors OAuthApp's
     * referencing-mcp-servers check and fails with FAILED_PRECONDITION
     * naming a referencing channel.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ChannelAppCommandController.
   * <pre>
   * ChannelAppCommandController handles write operations for channel apps.
   * &#64;internal
   * ChannelApps hold provider secrets (client_secret, signing_secret) and
   * are always org-private. There is no updateVisibility RPC — public
   * visibility is intentionally unsupported to prevent credential leakage
   * (the OAuthApp posture).
   * </pre>
   */
  public static final class ChannelAppCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ChannelAppCommandControllerBlockingV2Stub> {
    private ChannelAppCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelAppCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelAppCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a channel app.
     * If the resource does not exist, creates a new channel app.
     * If the resource exists, updates the existing channel app. Sending
     * the redaction marker for a secret field preserves the stored value.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel app is going to be created or updated, resolved
     * as part of request execution.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp apply(ai.stigmer.agentic.channelapp.v1.ChannelApp request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a channel app.
     * The creator's organization owns the channel app. The creator is
     * granted the owner role automatically.
     * &#64;internal
     * Authorization: requires can_create_channel_app permission in the
     * organization (admin-gated like can_create_oauth_app — the resource
     * holds org-wide webhook credentials).
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp create(ai.stigmer.agentic.channelapp.v1.ChannelApp request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing channel app.
     * Sending the redaction marker for a secret field preserves the
     * stored value; the provider arm is immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the channel_app
     * resource.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp update(ai.stigmer.agentic.channelapp.v1.ChannelApp request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a channel app.
     * Deletion is blocked while any AgentChannel references this app via
     * spec.app_ref — disconnect or delete those channels first.
     * &#64;internal
     * Authorization: requires can_delete permission on the channel_app
     * resource. The referencing-channels block mirrors OAuthApp's
     * referencing-mcp-servers check and fails with FAILED_PRECONDITION
     * naming a referencing channel.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ChannelAppCommandController.
   * <pre>
   * ChannelAppCommandController handles write operations for channel apps.
   * &#64;internal
   * ChannelApps hold provider secrets (client_secret, signing_secret) and
   * are always org-private. There is no updateVisibility RPC — public
   * visibility is intentionally unsupported to prevent credential leakage
   * (the OAuthApp posture).
   * </pre>
   */
  public static final class ChannelAppCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ChannelAppCommandControllerBlockingStub> {
    private ChannelAppCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelAppCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelAppCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a channel app.
     * If the resource does not exist, creates a new channel app.
     * If the resource exists, updates the existing channel app. Sending
     * the redaction marker for a secret field preserves the stored value.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel app is going to be created or updated, resolved
     * as part of request execution.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp apply(ai.stigmer.agentic.channelapp.v1.ChannelApp request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a channel app.
     * The creator's organization owns the channel app. The creator is
     * granted the owner role automatically.
     * &#64;internal
     * Authorization: requires can_create_channel_app permission in the
     * organization (admin-gated like can_create_oauth_app — the resource
     * holds org-wide webhook credentials).
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp create(ai.stigmer.agentic.channelapp.v1.ChannelApp request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing channel app.
     * Sending the redaction marker for a secret field preserves the
     * stored value; the provider arm is immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the channel_app
     * resource.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp update(ai.stigmer.agentic.channelapp.v1.ChannelApp request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a channel app.
     * Deletion is blocked while any AgentChannel references this app via
     * spec.app_ref — disconnect or delete those channels first.
     * &#64;internal
     * Authorization: requires can_delete permission on the channel_app
     * resource. The referencing-channels block mirrors OAuthApp's
     * referencing-mcp-servers check and fails with FAILED_PRECONDITION
     * naming a referencing channel.
     * </pre>
     */
    public ai.stigmer.agentic.channelapp.v1.ChannelApp delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ChannelAppCommandController.
   * <pre>
   * ChannelAppCommandController handles write operations for channel apps.
   * &#64;internal
   * ChannelApps hold provider secrets (client_secret, signing_secret) and
   * are always org-private. There is no updateVisibility RPC — public
   * visibility is intentionally unsupported to prevent credential leakage
   * (the OAuthApp posture).
   * </pre>
   */
  public static final class ChannelAppCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ChannelAppCommandControllerFutureStub> {
    private ChannelAppCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelAppCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelAppCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a channel app.
     * If the resource does not exist, creates a new channel app.
     * If the resource exists, updates the existing channel app. Sending
     * the redaction marker for a secret field preserves the stored value.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the channel app is going to be created or updated, resolved
     * as part of request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channelapp.v1.ChannelApp> apply(
        ai.stigmer.agentic.channelapp.v1.ChannelApp request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a channel app.
     * The creator's organization owns the channel app. The creator is
     * granted the owner role automatically.
     * &#64;internal
     * Authorization: requires can_create_channel_app permission in the
     * organization (admin-gated like can_create_oauth_app — the resource
     * holds org-wide webhook credentials).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channelapp.v1.ChannelApp> create(
        ai.stigmer.agentic.channelapp.v1.ChannelApp request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing channel app.
     * Sending the redaction marker for a secret field preserves the
     * stored value; the provider arm is immutable.
     * &#64;internal
     * Authorization: requires can_edit permission on the channel_app
     * resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channelapp.v1.ChannelApp> update(
        ai.stigmer.agentic.channelapp.v1.ChannelApp request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a channel app.
     * Deletion is blocked while any AgentChannel references this app via
     * spec.app_ref — disconnect or delete those channels first.
     * &#64;internal
     * Authorization: requires can_delete permission on the channel_app
     * resource. The referencing-channels block mirrors OAuthApp's
     * referencing-mcp-servers check and fails with FAILED_PRECONDITION
     * naming a referencing channel.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.channelapp.v1.ChannelApp> delete(
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
          serviceImpl.apply((ai.stigmer.agentic.channelapp.v1.ChannelApp) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.channelapp.v1.ChannelApp) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.channelapp.v1.ChannelApp) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.channelapp.v1.ChannelApp>) responseObserver);
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
              ai.stigmer.agentic.channelapp.v1.ChannelApp,
              ai.stigmer.agentic.channelapp.v1.ChannelApp>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channelapp.v1.ChannelApp,
              ai.stigmer.agentic.channelapp.v1.ChannelApp>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.channelapp.v1.ChannelApp,
              ai.stigmer.agentic.channelapp.v1.ChannelApp>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.agentic.channelapp.v1.ChannelApp>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ChannelAppCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ChannelAppCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.channelapp.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ChannelAppCommandController");
    }
  }

  private static final class ChannelAppCommandControllerFileDescriptorSupplier
      extends ChannelAppCommandControllerBaseDescriptorSupplier {
    ChannelAppCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ChannelAppCommandControllerMethodDescriptorSupplier
      extends ChannelAppCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ChannelAppCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ChannelAppCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ChannelAppCommandControllerFileDescriptorSupplier())
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
