package ai.stigmer.agentic.plugin.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * PluginQueryController handles read operations for plugins.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PluginQueryControllerGrpc {

  private PluginQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.plugin.v1.PluginQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PluginId,
      ai.stigmer.agentic.plugin.v1.Plugin> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.plugin.v1.PluginId.class,
      responseType = ai.stigmer.agentic.plugin.v1.Plugin.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PluginId,
      ai.stigmer.agentic.plugin.v1.Plugin> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PluginId, ai.stigmer.agentic.plugin.v1.Plugin> getGetMethod;
    if ((getGetMethod = PluginQueryControllerGrpc.getGetMethod) == null) {
      synchronized (PluginQueryControllerGrpc.class) {
        if ((getGetMethod = PluginQueryControllerGrpc.getGetMethod) == null) {
          PluginQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugin.v1.PluginId, ai.stigmer.agentic.plugin.v1.Plugin>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.PluginId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.Plugin.getDefaultInstance()))
              .setSchemaDescriptor(new PluginQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.plugin.v1.Plugin> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.plugin.v1.Plugin.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.plugin.v1.Plugin> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.plugin.v1.Plugin> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = PluginQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (PluginQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = PluginQueryControllerGrpc.getGetByReferenceMethod) == null) {
          PluginQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.plugin.v1.Plugin>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.Plugin.getDefaultInstance()))
              .setSchemaDescriptor(new PluginQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PluginId,
      ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse> getListMembersMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listMembers",
      requestType = ai.stigmer.agentic.plugin.v1.PluginId.class,
      responseType = ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PluginId,
      ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse> getListMembersMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.PluginId, ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse> getListMembersMethod;
    if ((getListMembersMethod = PluginQueryControllerGrpc.getListMembersMethod) == null) {
      synchronized (PluginQueryControllerGrpc.class) {
        if ((getListMembersMethod = PluginQueryControllerGrpc.getListMembersMethod) == null) {
          PluginQueryControllerGrpc.getListMembersMethod = getListMembersMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugin.v1.PluginId, ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listMembers"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.PluginId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse.getDefaultInstance()))
              .setSchemaDescriptor(new PluginQueryControllerMethodDescriptorSupplier("listMembers"))
              .build();
        }
      }
    }
    return getListMembersMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput,
      ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse> getListVersionsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listVersions",
      requestType = ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput.class,
      responseType = ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput,
      ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse> getListVersionsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput, ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse> getListVersionsMethod;
    if ((getListVersionsMethod = PluginQueryControllerGrpc.getListVersionsMethod) == null) {
      synchronized (PluginQueryControllerGrpc.class) {
        if ((getListVersionsMethod = PluginQueryControllerGrpc.getListVersionsMethod) == null) {
          PluginQueryControllerGrpc.getListVersionsMethod = getListVersionsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput, ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listVersions"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse.getDefaultInstance()))
              .setSchemaDescriptor(new PluginQueryControllerMethodDescriptorSupplier("listVersions"))
              .build();
        }
      }
    }
    return getListVersionsMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PluginQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginQueryControllerStub>() {
        @java.lang.Override
        public PluginQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginQueryControllerStub(channel, callOptions);
        }
      };
    return PluginQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PluginQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public PluginQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PluginQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PluginQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginQueryControllerBlockingStub>() {
        @java.lang.Override
        public PluginQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return PluginQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PluginQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PluginQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PluginQueryControllerFutureStub>() {
        @java.lang.Override
        public PluginQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PluginQueryControllerFutureStub(channel, callOptions);
        }
      };
    return PluginQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * PluginQueryController handles read operations for plugins.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single plugin by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.plugin.v1.PluginId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a plugin by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the installed version
     * - Tag name (the manifest version, e.g. "1.2.0") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to
     * a plugin ID (the input carries org and slug, not an id).
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the resources an installed plugin materialised.
     * Returns every skill, MCP server, agent and workflow the plugin owns, in
     * materialisation order.
     * &#64;internal
     * Derived on read from the stigmer.ai/plugin label on the four child kinds.
     * </pre>
     */
    default void listMembers(ai.stigmer.agentic.plugin.v1.PluginId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMembersMethod(), responseObserver);
    }

    /**
     * <pre>
     * List version history for a plugin.
     * Returns every installed version ordered by push time (newest first), with
     * its digest, tag, actor and archive storage key.
     * &#64;internal
     * Authorization is handled in the handler after resolving the plugin (the
     * input carries org and slug, not an id).
     * </pre>
     */
    default void listVersions(ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListVersionsMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PluginQueryController.
   * <pre>
   * PluginQueryController handles read operations for plugins.
   * </pre>
   */
  public static abstract class PluginQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PluginQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PluginQueryController.
   * <pre>
   * PluginQueryController handles read operations for plugins.
   * </pre>
   */
  public static final class PluginQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PluginQueryControllerStub> {
    private PluginQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single plugin by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.plugin.v1.PluginId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a plugin by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the installed version
     * - Tag name (the manifest version, e.g. "1.2.0") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to
     * a plugin ID (the input carries org and slug, not an id).
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the resources an installed plugin materialised.
     * Returns every skill, MCP server, agent and workflow the plugin owns, in
     * materialisation order.
     * &#64;internal
     * Derived on read from the stigmer.ai/plugin label on the four child kinds.
     * </pre>
     */
    public void listMembers(ai.stigmer.agentic.plugin.v1.PluginId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMembersMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List version history for a plugin.
     * Returns every installed version ordered by push time (newest first), with
     * its digest, tag, actor and archive storage key.
     * &#64;internal
     * Authorization is handled in the handler after resolving the plugin (the
     * input carries org and slug, not an id).
     * </pre>
     */
    public void listVersions(ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PluginQueryController.
   * <pre>
   * PluginQueryController handles read operations for plugins.
   * </pre>
   */
  public static final class PluginQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PluginQueryControllerBlockingV2Stub> {
    private PluginQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single plugin by ID.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin get(ai.stigmer.agentic.plugin.v1.PluginId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a plugin by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the installed version
     * - Tag name (the manifest version, e.g. "1.2.0") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to
     * a plugin ID (the input carries org and slug, not an id).
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the resources an installed plugin materialised.
     * Returns every skill, MCP server, agent and workflow the plugin owns, in
     * materialisation order.
     * &#64;internal
     * Derived on read from the stigmer.ai/plugin label on the four child kinds.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse listMembers(ai.stigmer.agentic.plugin.v1.PluginId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMembersMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List version history for a plugin.
     * Returns every installed version ordered by push time (newest first), with
     * its digest, tag, actor and archive storage key.
     * &#64;internal
     * Authorization is handled in the handler after resolving the plugin (the
     * input carries org and slug, not an id).
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse listVersions(ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PluginQueryController.
   * <pre>
   * PluginQueryController handles read operations for plugins.
   * </pre>
   */
  public static final class PluginQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PluginQueryControllerBlockingStub> {
    private PluginQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single plugin by ID.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin get(ai.stigmer.agentic.plugin.v1.PluginId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a plugin by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the installed version
     * - Tag name (the manifest version, e.g. "1.2.0") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to
     * a plugin ID (the input carries org and slug, not an id).
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.Plugin getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the resources an installed plugin materialised.
     * Returns every skill, MCP server, agent and workflow the plugin owns, in
     * materialisation order.
     * &#64;internal
     * Derived on read from the stigmer.ai/plugin label on the four child kinds.
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse listMembers(ai.stigmer.agentic.plugin.v1.PluginId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMembersMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List version history for a plugin.
     * Returns every installed version ordered by push time (newest first), with
     * its digest, tag, actor and archive storage key.
     * &#64;internal
     * Authorization is handled in the handler after resolving the plugin (the
     * input carries org and slug, not an id).
     * </pre>
     */
    public ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse listVersions(ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PluginQueryController.
   * <pre>
   * PluginQueryController handles read operations for plugins.
   * </pre>
   */
  public static final class PluginQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PluginQueryControllerFutureStub> {
    private PluginQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PluginQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PluginQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single plugin by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugin.v1.Plugin> get(
        ai.stigmer.agentic.plugin.v1.PluginId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a plugin by API resource reference with version support.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the installed version
     * - Tag name (the manifest version, e.g. "1.2.0") → Resolves to the version holding this tag
     * - SHA-256 digest (64 hex chars) → Returns the exact immutable version
     * &#64;internal
     * Authorization is handled in the handler after resolving the reference to
     * a plugin ID (the input carries org and slug, not an id).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugin.v1.Plugin> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the resources an installed plugin materialised.
     * Returns every skill, MCP server, agent and workflow the plugin owns, in
     * materialisation order.
     * &#64;internal
     * Derived on read from the stigmer.ai/plugin label on the four child kinds.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse> listMembers(
        ai.stigmer.agentic.plugin.v1.PluginId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMembersMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List version history for a plugin.
     * Returns every installed version ordered by push time (newest first), with
     * its digest, tag, actor and archive storage key.
     * &#64;internal
     * Authorization is handled in the handler after resolving the plugin (the
     * input carries org and slug, not an id).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse> listVersions(
        ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST_MEMBERS = 2;
  private static final int METHODID_LIST_VERSIONS = 3;

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
          serviceImpl.get((ai.stigmer.agentic.plugin.v1.PluginId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.Plugin>) responseObserver);
          break;
        case METHODID_LIST_MEMBERS:
          serviceImpl.listMembers((ai.stigmer.agentic.plugin.v1.PluginId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse>) responseObserver);
          break;
        case METHODID_LIST_VERSIONS:
          serviceImpl.listVersions((ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse>) responseObserver);
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
              ai.stigmer.agentic.plugin.v1.PluginId,
              ai.stigmer.agentic.plugin.v1.Plugin>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.plugin.v1.Plugin>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListMembersMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.plugin.v1.PluginId,
              ai.stigmer.agentic.plugin.v1.ListPluginMembersResponse>(
                service, METHODID_LIST_MEMBERS)))
        .addMethod(
          getListVersionsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.plugin.v1.ListPluginVersionsInput,
              ai.stigmer.agentic.plugin.v1.ListPluginVersionsResponse>(
                service, METHODID_LIST_VERSIONS)))
        .build();
  }

  private static abstract class PluginQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PluginQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.plugin.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PluginQueryController");
    }
  }

  private static final class PluginQueryControllerFileDescriptorSupplier
      extends PluginQueryControllerBaseDescriptorSupplier {
    PluginQueryControllerFileDescriptorSupplier() {}
  }

  private static final class PluginQueryControllerMethodDescriptorSupplier
      extends PluginQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PluginQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PluginQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PluginQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListMembersMethod())
              .addMethod(getListVersionsMethod())
              .build();
        }
      }
    }
    return result;
  }
}
