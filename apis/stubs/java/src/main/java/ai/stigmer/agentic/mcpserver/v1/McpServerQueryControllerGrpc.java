package ai.stigmer.agentic.mcpserver.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * McpServerQueryController provides read operations for MCP server resources.
 * &#64;internal
 * Authorization model:
 * - Platform-scoped: Anyone can view (public marketplace)
 * - Organization-scoped: Org members can view
 * - Identity-account-scoped: Only the owner can view
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class McpServerQueryControllerGrpc {

  private McpServerQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.mcpserver.v1.McpServerQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.mcpserver.v1.McpServer> getGetMethod;
    if ((getGetMethod = McpServerQueryControllerGrpc.getGetMethod) == null) {
      synchronized (McpServerQueryControllerGrpc.class) {
        if ((getGetMethod = McpServerQueryControllerGrpc.getGetMethod) == null) {
          McpServerQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.mcpserver.v1.McpServer> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = McpServerQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (McpServerQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = McpServerQueryControllerGrpc.getGetByReferenceMethod) == null) {
          McpServerQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput,
      ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput> getGetOAuthGrantStatusMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getOAuthGrantStatus",
      requestType = ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput,
      ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput> getGetOAuthGrantStatusMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput, ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput> getGetOAuthGrantStatusMethod;
    if ((getGetOAuthGrantStatusMethod = McpServerQueryControllerGrpc.getGetOAuthGrantStatusMethod) == null) {
      synchronized (McpServerQueryControllerGrpc.class) {
        if ((getGetOAuthGrantStatusMethod = McpServerQueryControllerGrpc.getGetOAuthGrantStatusMethod) == null) {
          McpServerQueryControllerGrpc.getGetOAuthGrantStatusMethod = getGetOAuthGrantStatusMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput, ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getOAuthGrantStatus"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerQueryControllerMethodDescriptorSupplier("getOAuthGrantStatus"))
              .build();
        }
      }
    }
    return getGetOAuthGrantStatusMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput,
      ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput> getGetOrgOAuthAppMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getOrgOAuthApp",
      requestType = ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput,
      ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput> getGetOrgOAuthAppMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput, ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput> getGetOrgOAuthAppMethod;
    if ((getGetOrgOAuthAppMethod = McpServerQueryControllerGrpc.getGetOrgOAuthAppMethod) == null) {
      synchronized (McpServerQueryControllerGrpc.class) {
        if ((getGetOrgOAuthAppMethod = McpServerQueryControllerGrpc.getGetOrgOAuthAppMethod) == null) {
          McpServerQueryControllerGrpc.getGetOrgOAuthAppMethod = getGetOrgOAuthAppMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput, ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getOrgOAuthApp"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerQueryControllerMethodDescriptorSupplier("getOrgOAuthApp"))
              .build();
        }
      }
    }
    return getGetOrgOAuthAppMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static McpServerQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerQueryControllerStub>() {
        @java.lang.Override
        public McpServerQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerQueryControllerStub(channel, callOptions);
        }
      };
    return McpServerQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static McpServerQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public McpServerQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return McpServerQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static McpServerQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerQueryControllerBlockingStub>() {
        @java.lang.Override
        public McpServerQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return McpServerQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static McpServerQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerQueryControllerFutureStub>() {
        @java.lang.Override
        public McpServerQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerQueryControllerFutureStub(channel, callOptions);
        }
      };
    return McpServerQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * McpServerQueryController provides read operations for MCP server resources.
   * &#64;internal
   * Authorization model:
   * - Platform-scoped: Anyone can view (public marketplace)
   * - Organization-scoped: Org members can view
   * - Identity-account-scoped: Only the owner can view
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an MCP server by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The caller must have access based on the resource's scope:
     * - Platform: All authenticated users
     * - Organization: Organization members
     * - Identity Account: Only the owner
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an MCP server by reference (scope + org + slug).
     * Preferred method for looking up MCP servers by name/slug rather than
     * system-generated ID.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * The handler performs scope-aware authorization based on the reference.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Check whether the authenticated user has an active OAuth grant for
     * an MCP server in the specified org.
     * Returns grant metadata (connected status, token expiry, auth method)
     * without exposing any secret token values. The frontend uses this to
     * render the correct OAuth state in the MCP server detail page and
     * session composer.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The resource_id field contains the MCP server's system-generated ID.
     * </pre>
     */
    default void getOAuthGrantStatus(ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetOAuthGrantStatusMethod(), responseObserver);
    }

    /**
     * <pre>
     * Query whether an org has a BYOA override for a resource.
     * Returns override metadata (existence, OAuthApp ID, client_id) without
     * exposing secrets. The frontend uses this to show which credential
     * source is active and to offer override management options to org admins.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * Any user who can view the MCP server can check whether their org has
     * an override — no secrets are exposed.
     * </pre>
     */
    default void getOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetOrgOAuthAppMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service McpServerQueryController.
   * <pre>
   * McpServerQueryController provides read operations for MCP server resources.
   * &#64;internal
   * Authorization model:
   * - Platform-scoped: Anyone can view (public marketplace)
   * - Organization-scoped: Org members can view
   * - Identity-account-scoped: Only the owner can view
   * </pre>
   */
  public static abstract class McpServerQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return McpServerQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service McpServerQueryController.
   * <pre>
   * McpServerQueryController provides read operations for MCP server resources.
   * &#64;internal
   * Authorization model:
   * - Platform-scoped: Anyone can view (public marketplace)
   * - Organization-scoped: Org members can view
   * - Identity-account-scoped: Only the owner can view
   * </pre>
   */
  public static final class McpServerQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<McpServerQueryControllerStub> {
    private McpServerQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an MCP server by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The caller must have access based on the resource's scope:
     * - Platform: All authenticated users
     * - Organization: Organization members
     * - Identity Account: Only the owner
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an MCP server by reference (scope + org + slug).
     * Preferred method for looking up MCP servers by name/slug rather than
     * system-generated ID.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * The handler performs scope-aware authorization based on the reference.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Check whether the authenticated user has an active OAuth grant for
     * an MCP server in the specified org.
     * Returns grant metadata (connected status, token expiry, auth method)
     * without exposing any secret token values. The frontend uses this to
     * render the correct OAuth state in the MCP server detail page and
     * session composer.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The resource_id field contains the MCP server's system-generated ID.
     * </pre>
     */
    public void getOAuthGrantStatus(ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetOAuthGrantStatusMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Query whether an org has a BYOA override for a resource.
     * Returns override metadata (existence, OAuthApp ID, client_id) without
     * exposing secrets. The frontend uses this to show which credential
     * source is active and to offer override management options to org admins.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * Any user who can view the MCP server can check whether their org has
     * an override — no secrets are exposed.
     * </pre>
     */
    public void getOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetOrgOAuthAppMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service McpServerQueryController.
   * <pre>
   * McpServerQueryController provides read operations for MCP server resources.
   * &#64;internal
   * Authorization model:
   * - Platform-scoped: Anyone can view (public marketplace)
   * - Organization-scoped: Org members can view
   * - Identity-account-scoped: Only the owner can view
   * </pre>
   */
  public static final class McpServerQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<McpServerQueryControllerBlockingV2Stub> {
    private McpServerQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an MCP server by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The caller must have access based on the resource's scope:
     * - Platform: All authenticated users
     * - Organization: Organization members
     * - Identity Account: Only the owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an MCP server by reference (scope + org + slug).
     * Preferred method for looking up MCP servers by name/slug rather than
     * system-generated ID.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * The handler performs scope-aware authorization based on the reference.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Check whether the authenticated user has an active OAuth grant for
     * an MCP server in the specified org.
     * Returns grant metadata (connected status, token expiry, auth method)
     * without exposing any secret token values. The frontend uses this to
     * render the correct OAuth state in the MCP server detail page and
     * session composer.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The resource_id field contains the MCP server's system-generated ID.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput getOAuthGrantStatus(ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetOAuthGrantStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Query whether an org has a BYOA override for a resource.
     * Returns override metadata (existence, OAuthApp ID, client_id) without
     * exposing secrets. The frontend uses this to show which credential
     * source is active and to offer override management options to org admins.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * Any user who can view the MCP server can check whether their org has
     * an override — no secrets are exposed.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput getOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetOrgOAuthAppMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service McpServerQueryController.
   * <pre>
   * McpServerQueryController provides read operations for MCP server resources.
   * &#64;internal
   * Authorization model:
   * - Platform-scoped: Anyone can view (public marketplace)
   * - Organization-scoped: Org members can view
   * - Identity-account-scoped: Only the owner can view
   * </pre>
   */
  public static final class McpServerQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<McpServerQueryControllerBlockingStub> {
    private McpServerQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an MCP server by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The caller must have access based on the resource's scope:
     * - Platform: All authenticated users
     * - Organization: Organization members
     * - Identity Account: Only the owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an MCP server by reference (scope + org + slug).
     * Preferred method for looking up MCP servers by name/slug rather than
     * system-generated ID.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * The handler performs scope-aware authorization based on the reference.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Check whether the authenticated user has an active OAuth grant for
     * an MCP server in the specified org.
     * Returns grant metadata (connected status, token expiry, auth method)
     * without exposing any secret token values. The frontend uses this to
     * render the correct OAuth state in the MCP server detail page and
     * session composer.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The resource_id field contains the MCP server's system-generated ID.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput getOAuthGrantStatus(ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetOAuthGrantStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Query whether an org has a BYOA override for a resource.
     * Returns override metadata (existence, OAuthApp ID, client_id) without
     * exposing secrets. The frontend uses this to show which credential
     * source is active and to offer override management options to org admins.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * Any user who can view the MCP server can check whether their org has
     * an override — no secrets are exposed.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput getOrgOAuthApp(ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetOrgOAuthAppMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service McpServerQueryController.
   * <pre>
   * McpServerQueryController provides read operations for MCP server resources.
   * &#64;internal
   * Authorization model:
   * - Platform-scoped: Anyone can view (public marketplace)
   * - Organization-scoped: Org members can view
   * - Identity-account-scoped: Only the owner can view
   * </pre>
   */
  public static final class McpServerQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<McpServerQueryControllerFutureStub> {
    private McpServerQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an MCP server by its unique identifier.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The caller must have access based on the resource's scope:
     * - Platform: All authenticated users
     * - Organization: Organization members
     * - Identity Account: Only the owner
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an MCP server by reference (scope + org + slug).
     * Preferred method for looking up MCP servers by name/slug rather than
     * system-generated ID.
     * &#64;internal
     * Authorization: Custom authorization in handler.
     * The handler performs scope-aware authorization based on the reference.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Check whether the authenticated user has an active OAuth grant for
     * an MCP server in the specified org.
     * Returns grant metadata (connected status, token expiry, auth method)
     * without exposing any secret token values. The frontend uses this to
     * render the correct OAuth state in the MCP server detail page and
     * session composer.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * The resource_id field contains the MCP server's system-generated ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput> getOAuthGrantStatus(
        ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetOAuthGrantStatusMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Query whether an org has a BYOA override for a resource.
     * Returns override metadata (existence, OAuthApp ID, client_id) without
     * exposing secrets. The frontend uses this to show which credential
     * source is active and to offer override management options to org admins.
     * &#64;internal
     * Authorization: Requires can_view permission on the mcp_server resource.
     * Any user who can view the MCP server can check whether their org has
     * an override — no secrets are exposed.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput> getOrgOAuthApp(
        ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetOrgOAuthAppMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_GET_OAUTH_GRANT_STATUS = 2;
  private static final int METHODID_GET_ORG_OAUTH_APP = 3;

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
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_GET_OAUTH_GRANT_STATUS:
          serviceImpl.getOAuthGrantStatus((ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput>) responseObserver);
          break;
        case METHODID_GET_ORG_OAUTH_APP:
          serviceImpl.getOrgOAuthApp((ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput>) responseObserver);
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
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getGetOAuthGrantStatusMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusInput,
              ai.stigmer.agentic.mcpserver.v1.GetOAuthGrantStatusOutput>(
                service, METHODID_GET_OAUTH_GRANT_STATUS)))
        .addMethod(
          getGetOrgOAuthAppMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppInput,
              ai.stigmer.agentic.mcpserver.v1.GetOrgOAuthAppOutput>(
                service, METHODID_GET_ORG_OAUTH_APP)))
        .build();
  }

  private static abstract class McpServerQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    McpServerQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.mcpserver.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("McpServerQueryController");
    }
  }

  private static final class McpServerQueryControllerFileDescriptorSupplier
      extends McpServerQueryControllerBaseDescriptorSupplier {
    McpServerQueryControllerFileDescriptorSupplier() {}
  }

  private static final class McpServerQueryControllerMethodDescriptorSupplier
      extends McpServerQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    McpServerQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (McpServerQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new McpServerQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getGetOAuthGrantStatusMethod())
              .addMethod(getGetOrgOAuthAppMethod())
              .build();
        }
      }
    }
    return result;
  }
}
