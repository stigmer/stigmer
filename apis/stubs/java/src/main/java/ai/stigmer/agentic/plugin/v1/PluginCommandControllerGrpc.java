package ai.stigmer.agentic.plugin.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * PluginCommandController handles write operations for plugins.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PluginCommandControllerGrpc {

  private PluginCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.plugin.v1.PluginCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PushPluginRequest,
      ai.stigmer.agentic.plugin.v1.Plugin> getPushMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "push",
      requestType = ai.stigmer.agentic.plugin.v1.PushPluginRequest.class,
      responseType = ai.stigmer.agentic.plugin.v1.Plugin.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PushPluginRequest,
      ai.stigmer.agentic.plugin.v1.Plugin> getPushMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PushPluginRequest, ai.stigmer.agentic.plugin.v1.Plugin> getPushMethod;
    if ((getPushMethod = PluginCommandControllerGrpc.getPushMethod) == null) {
      synchronized (PluginCommandControllerGrpc.class) {
        if ((getPushMethod = PluginCommandControllerGrpc.getPushMethod) == null) {
          PluginCommandControllerGrpc.getPushMethod = getPushMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugin.v1.PushPluginRequest, ai.stigmer.agentic.plugin.v1.Plugin>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "push"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.PushPluginRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.Plugin.getDefaultInstance()))
              .setSchemaDescriptor(new PluginCommandControllerMethodDescriptorSupplier("push"))
              .build();
        }
      }
    }
    return getPushMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest,
      ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl> getCreateArtifactUploadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "createArtifactUploadUrl",
      requestType = ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest.class,
      responseType = ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest,
      ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl> getCreateArtifactUploadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest, ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl> getCreateArtifactUploadUrlMethod;
    if ((getCreateArtifactUploadUrlMethod = PluginCommandControllerGrpc.getCreateArtifactUploadUrlMethod) == null) {
      synchronized (PluginCommandControllerGrpc.class) {
        if ((getCreateArtifactUploadUrlMethod = PluginCommandControllerGrpc.getCreateArtifactUploadUrlMethod) == null) {
          PluginCommandControllerGrpc.getCreateArtifactUploadUrlMethod = getCreateArtifactUploadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest, ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "createArtifactUploadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl.getDefaultInstance()))
              .setSchemaDescriptor(new PluginCommandControllerMethodDescriptorSupplier("createArtifactUploadUrl"))
              .build();
        }
      }
    }
    return getCreateArtifactUploadUrlMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.plugin.v1.Plugin> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.plugin.v1.Plugin.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.plugin.v1.Plugin> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.plugin.v1.Plugin> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = PluginCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (PluginCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = PluginCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          PluginCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.plugin.v1.Plugin>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.Plugin.getDefaultInstance()))
              .setSchemaDescriptor(new PluginCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PluginId,
      ai.stigmer.agentic.plugin.v1.Plugin> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.plugin.v1.PluginId.class,
      responseType = ai.stigmer.agentic.plugin.v1.Plugin.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PluginId,
      ai.stigmer.agentic.plugin.v1.Plugin> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PluginId, ai.stigmer.agentic.plugin.v1.Plugin> getDeleteMethod;
    if ((getDeleteMethod = PluginCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (PluginCommandControllerGrpc.class) {
        if ((getDeleteMethod = PluginCommandControllerGrpc.getDeleteMethod) == null) {
          PluginCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugin.v1.PluginId, ai.stigmer.agentic.plugin.v1.Plugin>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.PluginId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.Plugin.getDefaultInstance()))
              .setSchemaDescriptor(new PluginCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PluginCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginCommandControllerStub>() {
        @java.lang.Override
        public PluginCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginCommandControllerStub(channel, callOptions);
        }
      };
    return PluginCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PluginCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public PluginCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PluginCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PluginCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginCommandControllerBlockingStub>() {
        @java.lang.Override
        public PluginCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return PluginCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PluginCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginCommandControllerFutureStub>() {
        @java.lang.Override
        public PluginCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginCommandControllerFutureStub(channel, callOptions);
        }
      };
    return PluginCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * PluginCommandController handles write operations for plugins.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Push a plugin archive to install or upgrade it.
     * Creates the plugin if it does not exist, or installs a new version of an
     * existing plugin; pushing the archive already installed changes nothing.
     * The archive is a plugin folder in the Agent Plugins, Cursor, Claude Code
     * or Codex layout; the response's status names what was materialised and
     * what was skipped.
     * &#64;internal
     * Authorization: can_create_plugin in the organization; each materialised
     * child runs its own create chain in-process AS THE CALLER, so the child
     * kinds' create permissions are evaluated too.
     * The backend reads the package, refuses reserved labels in the overlay,
     * plans every child slug against the organization, stores the archive
     * (deduplicated by digest), archives the previous version, persists the
     * head as INSTALLING, materialises skills, MCP servers, the agent and
     * workflows, removes members the new archive dropped, and persists the
     * head as READY. A re-push whose digest, state and members already
     * converge returns the head with no child writes.
     * </pre>
     */
    default void push(ai.stigmer.agentic.plugin.v1.PushPluginRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPushMethod(), responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a plugin archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushPluginRequest{ artifact_upload_ref })
     * &#64;internal
     * Authorization matches push(): the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it. The slots
     * are the skill transfer lane's, one upload surface for every archive.
     * </pre>
     */
    default void createArtifactUploadUrl(ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateArtifactUploadUrlMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of a plugin and of every resource it materialised.
     * Only modifies metadata.visibility on the plugin and its members.
     * &#64;internal
     * Authorization: can_edit on the plugin for every transition. The level
     * is checked against the plugin's and every member kind's VisibilityConfig
     * (visibility_public is refused for every kind). The fan-out to members
     * rides each kind's own updateVisibility chain in-process as the caller,
     * skills and MCP servers before the agents and workflows that reference
     * them, so every member meets its reference floor.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a plugin and every resource it materialised.
     * Refused when a resource outside the plugin still references a member;
     * the error names the referencing resources.
     * &#64;internal
     * Members are deleted through their own delete chains in-process (agent,
     * workflows, MCP servers, skills, in that order), then the head; a
     * failure part-way leaves a plugin whose remaining members are still
     * listed, and a retry converges. Audit history is preserved.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.plugin.v1.PluginId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PluginCommandController.
   * <pre>
   * PluginCommandController handles write operations for plugins.
   * </pre>
   */
  public static abstract class PluginCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PluginCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PluginCommandController.
   * <pre>
   * PluginCommandController handles write operations for plugins.
   * </pre>
   */
  public static final class PluginCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PluginCommandControllerStub> {
    private PluginCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Push a plugin archive to install or upgrade it.
     * Creates the plugin if it does not exist, or installs a new version of an
     * existing plugin; pushing the archive already installed changes nothing.
     * The archive is a plugin folder in the Agent Plugins, Cursor, Claude Code
     * or Codex layout; the response's status names what was materialised and
     * what was skipped.
     * &#64;internal
     * Authorization: can_create_plugin in the organization; each materialised
     * child runs its own create chain in-process AS THE CALLER, so the child
     * kinds' create permissions are evaluated too.
     * The backend reads the package, refuses reserved labels in the overlay,
     * plans every child slug against the organization, stores the archive
     * (deduplicated by digest), archives the previous version, persists the
     * head as INSTALLING, materialises skills, MCP servers, the agent and
     * workflows, removes members the new archive dropped, and persists the
     * head as READY. A re-push whose digest, state and members already
     * converge returns the head with no child writes.
     * </pre>
     */
    public void push(ai.stigmer.agentic.plugin.v1.PushPluginRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPushMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a plugin archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushPluginRequest{ artifact_upload_ref })
     * &#64;internal
     * Authorization matches push(): the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it. The slots
     * are the skill transfer lane's, one upload surface for every archive.
     * </pre>
     */
    public void createArtifactUploadUrl(ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateArtifactUploadUrlMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of a plugin and of every resource it materialised.
     * Only modifies metadata.visibility on the plugin and its members.
     * &#64;internal
     * Authorization: can_edit on the plugin for every transition. The level
     * is checked against the plugin's and every member kind's VisibilityConfig
     * (visibility_public is refused for every kind). The fan-out to members
     * rides each kind's own updateVisibility chain in-process as the caller,
     * skills and MCP servers before the agents and workflows that reference
     * them, so every member meets its reference floor.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a plugin and every resource it materialised.
     * Refused when a resource outside the plugin still references a member;
     * the error names the referencing resources.
     * &#64;internal
     * Members are deleted through their own delete chains in-process (agent,
     * workflows, MCP servers, skills, in that order), then the head; a
     * failure part-way leaves a plugin whose remaining members are still
     * listed, and a retry converges. Audit history is preserved.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.plugin.v1.PluginId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PluginCommandController.
   * <pre>
   * PluginCommandController handles write operations for plugins.
   * </pre>
   */
  public static final class PluginCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PluginCommandControllerBlockingV2Stub> {
    private PluginCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Push a plugin archive to install or upgrade it.
     * Creates the plugin if it does not exist, or installs a new version of an
     * existing plugin; pushing the archive already installed changes nothing.
     * The archive is a plugin folder in the Agent Plugins, Cursor, Claude Code
     * or Codex layout; the response's status names what was materialised and
     * what was skipped.
     * &#64;internal
     * Authorization: can_create_plugin in the organization; each materialised
     * child runs its own create chain in-process AS THE CALLER, so the child
     * kinds' create permissions are evaluated too.
     * The backend reads the package, refuses reserved labels in the overlay,
     * plans every child slug against the organization, stores the archive
     * (deduplicated by digest), archives the previous version, persists the
     * head as INSTALLING, materialises skills, MCP servers, the agent and
     * workflows, removes members the new archive dropped, and persists the
     * head as READY. A re-push whose digest, state and members already
     * converge returns the head with no child writes.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin push(ai.stigmer.agentic.plugin.v1.PushPluginRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPushMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a plugin archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushPluginRequest{ artifact_upload_ref })
     * &#64;internal
     * Authorization matches push(): the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it. The slots
     * are the skill transfer lane's, one upload surface for every archive.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl createArtifactUploadUrl(ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateArtifactUploadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of a plugin and of every resource it materialised.
     * Only modifies metadata.visibility on the plugin and its members.
     * &#64;internal
     * Authorization: can_edit on the plugin for every transition. The level
     * is checked against the plugin's and every member kind's VisibilityConfig
     * (visibility_public is refused for every kind). The fan-out to members
     * rides each kind's own updateVisibility chain in-process as the caller,
     * skills and MCP servers before the agents and workflows that reference
     * them, so every member meets its reference floor.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a plugin and every resource it materialised.
     * Refused when a resource outside the plugin still references a member;
     * the error names the referencing resources.
     * &#64;internal
     * Members are deleted through their own delete chains in-process (agent,
     * workflows, MCP servers, skills, in that order), then the head; a
     * failure part-way leaves a plugin whose remaining members are still
     * listed, and a retry converges. Audit history is preserved.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin delete(ai.stigmer.agentic.plugin.v1.PluginId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PluginCommandController.
   * <pre>
   * PluginCommandController handles write operations for plugins.
   * </pre>
   */
  public static final class PluginCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PluginCommandControllerBlockingStub> {
    private PluginCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Push a plugin archive to install or upgrade it.
     * Creates the plugin if it does not exist, or installs a new version of an
     * existing plugin; pushing the archive already installed changes nothing.
     * The archive is a plugin folder in the Agent Plugins, Cursor, Claude Code
     * or Codex layout; the response's status names what was materialised and
     * what was skipped.
     * &#64;internal
     * Authorization: can_create_plugin in the organization; each materialised
     * child runs its own create chain in-process AS THE CALLER, so the child
     * kinds' create permissions are evaluated too.
     * The backend reads the package, refuses reserved labels in the overlay,
     * plans every child slug against the organization, stores the archive
     * (deduplicated by digest), archives the previous version, persists the
     * head as INSTALLING, materialises skills, MCP servers, the agent and
     * workflows, removes members the new archive dropped, and persists the
     * head as READY. A re-push whose digest, state and members already
     * converge returns the head with no child writes.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin push(ai.stigmer.agentic.plugin.v1.PushPluginRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPushMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a plugin archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushPluginRequest{ artifact_upload_ref })
     * &#64;internal
     * Authorization matches push(): the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it. The slots
     * are the skill transfer lane's, one upload surface for every archive.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl createArtifactUploadUrl(ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateArtifactUploadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of a plugin and of every resource it materialised.
     * Only modifies metadata.visibility on the plugin and its members.
     * &#64;internal
     * Authorization: can_edit on the plugin for every transition. The level
     * is checked against the plugin's and every member kind's VisibilityConfig
     * (visibility_public is refused for every kind). The fan-out to members
     * rides each kind's own updateVisibility chain in-process as the caller,
     * skills and MCP servers before the agents and workflows that reference
     * them, so every member meets its reference floor.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a plugin and every resource it materialised.
     * Refused when a resource outside the plugin still references a member;
     * the error names the referencing resources.
     * &#64;internal
     * Members are deleted through their own delete chains in-process (agent,
     * workflows, MCP servers, skills, in that order), then the head; a
     * failure part-way leaves a plugin whose remaining members are still
     * listed, and a retry converges. Audit history is preserved.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin delete(ai.stigmer.agentic.plugin.v1.PluginId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PluginCommandController.
   * <pre>
   * PluginCommandController handles write operations for plugins.
   * </pre>
   */
  public static final class PluginCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PluginCommandControllerFutureStub> {
    private PluginCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Push a plugin archive to install or upgrade it.
     * Creates the plugin if it does not exist, or installs a new version of an
     * existing plugin; pushing the archive already installed changes nothing.
     * The archive is a plugin folder in the Agent Plugins, Cursor, Claude Code
     * or Codex layout; the response's status names what was materialised and
     * what was skipped.
     * &#64;internal
     * Authorization: can_create_plugin in the organization; each materialised
     * child runs its own create chain in-process AS THE CALLER, so the child
     * kinds' create permissions are evaluated too.
     * The backend reads the package, refuses reserved labels in the overlay,
     * plans every child slug against the organization, stores the archive
     * (deduplicated by digest), archives the previous version, persists the
     * head as INSTALLING, materialises skills, MCP servers, the agent and
     * workflows, removes members the new archive dropped, and persists the
     * head as READY. A re-push whose digest, state and members already
     * converge returns the head with no child writes.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugin.v1.Plugin> push(
        ai.stigmer.agentic.plugin.v1.PushPluginRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPushMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Mint a short-lived, single-use upload URL for staging a plugin archive
     * that exceeds the gRPC message-size cap (10MB). Flow:
     * 1. createArtifactUploadUrl(org, size_bytes) → { url, artifact_upload_ref }
     * 2. HTTP PUT the ZIP bytes to url
     * 3. push(PushPluginRequest{ artifact_upload_ref })
     * &#64;internal
     * Authorization matches push(): the URL is a capability to stage bytes,
     * so minting one requires the same permission as consuming it. The slots
     * are the skill transfer lane's, one upload surface for every archive.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl> createArtifactUploadUrl(
        ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateArtifactUploadUrlMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of a plugin and of every resource it materialised.
     * Only modifies metadata.visibility on the plugin and its members.
     * &#64;internal
     * Authorization: can_edit on the plugin for every transition. The level
     * is checked against the plugin's and every member kind's VisibilityConfig
     * (visibility_public is refused for every kind). The fan-out to members
     * rides each kind's own updateVisibility chain in-process as the caller,
     * skills and MCP servers before the agents and workflows that reference
     * them, so every member meets its reference floor.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugin.v1.Plugin> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a plugin and every resource it materialised.
     * Refused when a resource outside the plugin still references a member;
     * the error names the referencing resources.
     * &#64;internal
     * Members are deleted through their own delete chains in-process (agent,
     * workflows, MCP servers, skills, in that order), then the head; a
     * failure part-way leaves a plugin whose remaining members are still
     * listed, and a retry converges. Audit history is preserved.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugin.v1.Plugin> delete(
        ai.stigmer.agentic.plugin.v1.PluginId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_PUSH = 0;
  private static final int METHODID_CREATE_ARTIFACT_UPLOAD_URL = 1;
  private static final int METHODID_UPDATE_VISIBILITY = 2;
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
        case METHODID_PUSH:
          serviceImpl.push((ai.stigmer.agentic.plugin.v1.PushPluginRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin>) responseObserver);
          break;
        case METHODID_CREATE_ARTIFACT_UPLOAD_URL:
          serviceImpl.createArtifactUploadUrl((ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.plugin.v1.PluginId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin>) responseObserver);
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
          getPushMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.plugin.v1.PushPluginRequest,
              ai.stigmer.agentic.plugin.v1.Plugin>(
                service, METHODID_PUSH)))
        .addMethod(
          getCreateArtifactUploadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.plugin.v1.CreatePluginArtifactUploadUrlRequest,
              ai.stigmer.agentic.plugin.v1.PluginArtifactUploadUrl>(
                service, METHODID_CREATE_ARTIFACT_UPLOAD_URL)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.plugin.v1.Plugin>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.plugin.v1.PluginId,
              ai.stigmer.agentic.plugin.v1.Plugin>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class PluginCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PluginCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.plugin.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PluginCommandController");
    }
  }

  private static final class PluginCommandControllerFileDescriptorSupplier
      extends PluginCommandControllerBaseDescriptorSupplier {
    PluginCommandControllerFileDescriptorSupplier() {}
  }

  private static final class PluginCommandControllerMethodDescriptorSupplier
      extends PluginCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PluginCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PluginCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PluginCommandControllerFileDescriptorSupplier())
              .addMethod(getPushMethod())
              .addMethod(getCreateArtifactUploadUrlMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
