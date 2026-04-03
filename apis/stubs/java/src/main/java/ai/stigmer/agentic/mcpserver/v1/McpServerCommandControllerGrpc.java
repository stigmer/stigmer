package ai.stigmer.agentic.mcpserver.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * McpServerCommandController provides write operations for MCP server resources.
 * Supports creating, updating, and deleting MCP server definitions.
 * Authorization model for writes:
 * - Platform-scoped: Only platform operators can create/modify
 * - Organization-scoped: Org admins can create/modify
 * - Identity-account-scoped: Only the owner can create/modify
 * Primary interface: The `apply` method provides Kubernetes-style idempotent
 * create-or-update semantics, which is the recommended approach for CLI usage.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class McpServerCommandControllerGrpc {

  private McpServerCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.mcpserver.v1.McpServerCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer> getApplyMethod;
    if ((getApplyMethod = McpServerCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getApplyMethod = McpServerCommandControllerGrpc.getApplyMethod) == null) {
          McpServerCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer> getCreateMethod;
    if ((getCreateMethod = McpServerCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getCreateMethod = McpServerCommandControllerGrpc.getCreateMethod) == null) {
          McpServerCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateMethod;
    if ((getUpdateMethod = McpServerCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getUpdateMethod = McpServerCommandControllerGrpc.getUpdateMethod) == null) {
          McpServerCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.McpServer, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.mcpserver.v1.McpServer> getDeleteMethod;
    if ((getDeleteMethod = McpServerCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getDeleteMethod = McpServerCommandControllerGrpc.getDeleteMethod) == null) {
          McpServerCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = McpServerCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = McpServerCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          McpServerCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateDiscoveredCapabilitiesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateDiscoveredCapabilities",
      requestType = ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateDiscoveredCapabilitiesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput, ai.stigmer.agentic.mcpserver.v1.McpServer> getUpdateDiscoveredCapabilitiesMethod;
    if ((getUpdateDiscoveredCapabilitiesMethod = McpServerCommandControllerGrpc.getUpdateDiscoveredCapabilitiesMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getUpdateDiscoveredCapabilitiesMethod = McpServerCommandControllerGrpc.getUpdateDiscoveredCapabilitiesMethod) == null) {
          McpServerCommandControllerGrpc.getUpdateDiscoveredCapabilitiesMethod = getUpdateDiscoveredCapabilitiesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateDiscoveredCapabilities"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("updateDiscoveredCapabilities"))
              .build();
        }
      }
    }
    return getUpdateDiscoveredCapabilitiesMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getDiscoverCapabilitiesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "discoverCapabilities",
      requestType = ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getDiscoverCapabilitiesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput, ai.stigmer.agentic.mcpserver.v1.McpServer> getDiscoverCapabilitiesMethod;
    if ((getDiscoverCapabilitiesMethod = McpServerCommandControllerGrpc.getDiscoverCapabilitiesMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getDiscoverCapabilitiesMethod = McpServerCommandControllerGrpc.getDiscoverCapabilitiesMethod) == null) {
          McpServerCommandControllerGrpc.getDiscoverCapabilitiesMethod = getDiscoverCapabilitiesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "discoverCapabilities"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("discoverCapabilities"))
              .build();
        }
      }
    }
    return getDiscoverCapabilitiesMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static McpServerCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerStub>() {
        @java.lang.Override
        public McpServerCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerCommandControllerStub(channel, callOptions);
        }
      };
    return McpServerCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static McpServerCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public McpServerCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return McpServerCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static McpServerCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerBlockingStub>() {
        @java.lang.Override
        public McpServerCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return McpServerCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static McpServerCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<McpServerCommandControllerFutureStub>() {
        @java.lang.Override
        public McpServerCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new McpServerCommandControllerFutureStub(channel, callOptions);
        }
      };
    return McpServerCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * Supports creating, updating, and deleting MCP server definitions.
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an MCP server resource (Kubernetes-style apply).
     * This is the primary interface for MCP server management.
     * Behavior:
     * - If the resource doesn't exist: Creates a new MCP server
     * - If the resource exists: Updates the existing MCP server
     * The resource is identified by (scope, org, slug) combination.
     * Input: Full McpServer resource with metadata and spec.
     * Returns: The created/updated McpServer with system-populated fields.
     * Authorization: Custom authorization in handler.
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    default void apply(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new MCP server resource.
     * Use this when you explicitly want to create a new resource
     * and want an error if it already exists.
     * Input: McpServer with metadata (scope, org, name/slug) and spec.
     * Returns: The created McpServer with system-generated ID and status.
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    default void create(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * Input: McpServer with metadata.id populated and updated spec.
     * Returns: The updated McpServer.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    default void update(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this MCP server will need to be updated.
     * Input: ApiResourceDeleteInput with resource_id and optional version_message.
     * Returns: The deleted McpServer (for confirmation/audit).
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an MCP server publicly accessible (marketplace-style sharing) or to
     * revoke public access without sending the entire resource.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the discovered capabilities (tools and resource templates) for an MCP server.
     * This is a targeted status update — it only modifies status.discovered_capabilities,
     * leaving spec, validation state, and other status fields untouched.
     * Typical flow:
     * 1. CLI calls getByReference(org/slug) to fetch the McpServer and its ID
     * 2. CLI connects to the MCP server locally and queries tools/resources
     * 3. CLI calls this RPC with the ID and discovered capabilities
     * Input: UpdateDiscoveredCapabilitiesInput with mcp_server_id and discovered_capabilities.
     * Returns: The updated McpServer with the new discovered capabilities.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    default void updateDiscoveredCapabilities(ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateDiscoveredCapabilitiesMethod(), responseObserver);
    }

    /**
     * <pre>
     * Discover the capabilities of an MCP server by connecting to it.
     * This triggers server-side discovery: the backend resolves credentials,
     * connects to the MCP server, enumerates tools and resource templates,
     * and stores the result.
     * The RPC blocks until discovery completes (up to ~30 seconds) and returns the
     * updated McpServer with populated status.discovered_capabilities.
     * &#64;internal
     * Typical flow:
     * 1. Web console ensures required credentials are saved in the user's personal environment
     * 2. Web console calls discoverCapabilities with the MCP server ID
     * 3. Backend resolves env vars from the user's personal environment
     * 4. Backend starts a Temporal workflow; agent-runner connects to the MCP server
     * 5. Discovered tools and resource templates are stored and returned
     * Input: DiscoverCapabilitiesInput with mcp_server_id.
     * Returns: The updated McpServer with discovered capabilities.
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    default void discoverCapabilities(ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDiscoverCapabilitiesMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * Supports creating, updating, and deleting MCP server definitions.
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static abstract class McpServerCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return McpServerCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * Supports creating, updating, and deleting MCP server definitions.
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static final class McpServerCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<McpServerCommandControllerStub> {
    private McpServerCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an MCP server resource (Kubernetes-style apply).
     * This is the primary interface for MCP server management.
     * Behavior:
     * - If the resource doesn't exist: Creates a new MCP server
     * - If the resource exists: Updates the existing MCP server
     * The resource is identified by (scope, org, slug) combination.
     * Input: Full McpServer resource with metadata and spec.
     * Returns: The created/updated McpServer with system-populated fields.
     * Authorization: Custom authorization in handler.
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    public void apply(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new MCP server resource.
     * Use this when you explicitly want to create a new resource
     * and want an error if it already exists.
     * Input: McpServer with metadata (scope, org, name/slug) and spec.
     * Returns: The created McpServer with system-generated ID and status.
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    public void create(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * Input: McpServer with metadata.id populated and updated spec.
     * Returns: The updated McpServer.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public void update(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this MCP server will need to be updated.
     * Input: ApiResourceDeleteInput with resource_id and optional version_message.
     * Returns: The deleted McpServer (for confirmation/audit).
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an MCP server publicly accessible (marketplace-style sharing) or to
     * revoke public access without sending the entire resource.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the discovered capabilities (tools and resource templates) for an MCP server.
     * This is a targeted status update — it only modifies status.discovered_capabilities,
     * leaving spec, validation state, and other status fields untouched.
     * Typical flow:
     * 1. CLI calls getByReference(org/slug) to fetch the McpServer and its ID
     * 2. CLI connects to the MCP server locally and queries tools/resources
     * 3. CLI calls this RPC with the ID and discovered capabilities
     * Input: UpdateDiscoveredCapabilitiesInput with mcp_server_id and discovered_capabilities.
     * Returns: The updated McpServer with the new discovered capabilities.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public void updateDiscoveredCapabilities(ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateDiscoveredCapabilitiesMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Discover the capabilities of an MCP server by connecting to it.
     * This triggers server-side discovery: the backend resolves credentials,
     * connects to the MCP server, enumerates tools and resource templates,
     * and stores the result.
     * The RPC blocks until discovery completes (up to ~30 seconds) and returns the
     * updated McpServer with populated status.discovered_capabilities.
     * &#64;internal
     * Typical flow:
     * 1. Web console ensures required credentials are saved in the user's personal environment
     * 2. Web console calls discoverCapabilities with the MCP server ID
     * 3. Backend resolves env vars from the user's personal environment
     * 4. Backend starts a Temporal workflow; agent-runner connects to the MCP server
     * 5. Discovered tools and resource templates are stored and returned
     * Input: DiscoverCapabilitiesInput with mcp_server_id.
     * Returns: The updated McpServer with discovered capabilities.
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public void discoverCapabilities(ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDiscoverCapabilitiesMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * Supports creating, updating, and deleting MCP server definitions.
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static final class McpServerCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<McpServerCommandControllerBlockingV2Stub> {
    private McpServerCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an MCP server resource (Kubernetes-style apply).
     * This is the primary interface for MCP server management.
     * Behavior:
     * - If the resource doesn't exist: Creates a new MCP server
     * - If the resource exists: Updates the existing MCP server
     * The resource is identified by (scope, org, slug) combination.
     * Input: Full McpServer resource with metadata and spec.
     * Returns: The created/updated McpServer with system-populated fields.
     * Authorization: Custom authorization in handler.
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer apply(ai.stigmer.agentic.mcpserver.v1.McpServer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new MCP server resource.
     * Use this when you explicitly want to create a new resource
     * and want an error if it already exists.
     * Input: McpServer with metadata (scope, org, name/slug) and spec.
     * Returns: The created McpServer with system-generated ID and status.
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer create(ai.stigmer.agentic.mcpserver.v1.McpServer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * Input: McpServer with metadata.id populated and updated spec.
     * Returns: The updated McpServer.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer update(ai.stigmer.agentic.mcpserver.v1.McpServer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this MCP server will need to be updated.
     * Input: ApiResourceDeleteInput with resource_id and optional version_message.
     * Returns: The deleted McpServer (for confirmation/audit).
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an MCP server publicly accessible (marketplace-style sharing) or to
     * revoke public access without sending the entire resource.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the discovered capabilities (tools and resource templates) for an MCP server.
     * This is a targeted status update — it only modifies status.discovered_capabilities,
     * leaving spec, validation state, and other status fields untouched.
     * Typical flow:
     * 1. CLI calls getByReference(org/slug) to fetch the McpServer and its ID
     * 2. CLI connects to the MCP server locally and queries tools/resources
     * 3. CLI calls this RPC with the ID and discovered capabilities
     * Input: UpdateDiscoveredCapabilitiesInput with mcp_server_id and discovered_capabilities.
     * Returns: The updated McpServer with the new discovered capabilities.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer updateDiscoveredCapabilities(ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateDiscoveredCapabilitiesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Discover the capabilities of an MCP server by connecting to it.
     * This triggers server-side discovery: the backend resolves credentials,
     * connects to the MCP server, enumerates tools and resource templates,
     * and stores the result.
     * The RPC blocks until discovery completes (up to ~30 seconds) and returns the
     * updated McpServer with populated status.discovered_capabilities.
     * &#64;internal
     * Typical flow:
     * 1. Web console ensures required credentials are saved in the user's personal environment
     * 2. Web console calls discoverCapabilities with the MCP server ID
     * 3. Backend resolves env vars from the user's personal environment
     * 4. Backend starts a Temporal workflow; agent-runner connects to the MCP server
     * 5. Discovered tools and resource templates are stored and returned
     * Input: DiscoverCapabilitiesInput with mcp_server_id.
     * Returns: The updated McpServer with discovered capabilities.
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer discoverCapabilities(ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDiscoverCapabilitiesMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * Supports creating, updating, and deleting MCP server definitions.
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static final class McpServerCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<McpServerCommandControllerBlockingStub> {
    private McpServerCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an MCP server resource (Kubernetes-style apply).
     * This is the primary interface for MCP server management.
     * Behavior:
     * - If the resource doesn't exist: Creates a new MCP server
     * - If the resource exists: Updates the existing MCP server
     * The resource is identified by (scope, org, slug) combination.
     * Input: Full McpServer resource with metadata and spec.
     * Returns: The created/updated McpServer with system-populated fields.
     * Authorization: Custom authorization in handler.
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer apply(ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new MCP server resource.
     * Use this when you explicitly want to create a new resource
     * and want an error if it already exists.
     * Input: McpServer with metadata (scope, org, name/slug) and spec.
     * Returns: The created McpServer with system-generated ID and status.
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer create(ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * Input: McpServer with metadata.id populated and updated spec.
     * Returns: The updated McpServer.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer update(ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this MCP server will need to be updated.
     * Input: ApiResourceDeleteInput with resource_id and optional version_message.
     * Returns: The deleted McpServer (for confirmation/audit).
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an MCP server publicly accessible (marketplace-style sharing) or to
     * revoke public access without sending the entire resource.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the discovered capabilities (tools and resource templates) for an MCP server.
     * This is a targeted status update — it only modifies status.discovered_capabilities,
     * leaving spec, validation state, and other status fields untouched.
     * Typical flow:
     * 1. CLI calls getByReference(org/slug) to fetch the McpServer and its ID
     * 2. CLI connects to the MCP server locally and queries tools/resources
     * 3. CLI calls this RPC with the ID and discovered capabilities
     * Input: UpdateDiscoveredCapabilitiesInput with mcp_server_id and discovered_capabilities.
     * Returns: The updated McpServer with the new discovered capabilities.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer updateDiscoveredCapabilities(ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateDiscoveredCapabilitiesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Discover the capabilities of an MCP server by connecting to it.
     * This triggers server-side discovery: the backend resolves credentials,
     * connects to the MCP server, enumerates tools and resource templates,
     * and stores the result.
     * The RPC blocks until discovery completes (up to ~30 seconds) and returns the
     * updated McpServer with populated status.discovered_capabilities.
     * &#64;internal
     * Typical flow:
     * 1. Web console ensures required credentials are saved in the user's personal environment
     * 2. Web console calls discoverCapabilities with the MCP server ID
     * 3. Backend resolves env vars from the user's personal environment
     * 4. Backend starts a Temporal workflow; agent-runner connects to the MCP server
     * 5. Discovered tools and resource templates are stored and returned
     * Input: DiscoverCapabilitiesInput with mcp_server_id.
     * Returns: The updated McpServer with discovered capabilities.
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer discoverCapabilities(ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDiscoverCapabilitiesMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
   * Supports creating, updating, and deleting MCP server definitions.
   * Authorization model for writes:
   * - Platform-scoped: Only platform operators can create/modify
   * - Organization-scoped: Org admins can create/modify
   * - Identity-account-scoped: Only the owner can create/modify
   * Primary interface: The `apply` method provides Kubernetes-style idempotent
   * create-or-update semantics, which is the recommended approach for CLI usage.
   * </pre>
   */
  public static final class McpServerCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<McpServerCommandControllerFutureStub> {
    private McpServerCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected McpServerCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new McpServerCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an MCP server resource (Kubernetes-style apply).
     * This is the primary interface for MCP server management.
     * Behavior:
     * - If the resource doesn't exist: Creates a new MCP server
     * - If the resource exists: Updates the existing MCP server
     * The resource is identified by (scope, org, slug) combination.
     * Input: Full McpServer resource with metadata and spec.
     * Returns: The created/updated McpServer with system-populated fields.
     * Authorization: Custom authorization in handler.
     * The handler determines whether this is a create or update operation
     * and performs appropriate scope-aware authorization:
     * - Create: Requires permission to create in the target scope
     * - Update: Requires can_edit on the existing resource
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> apply(
        ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new MCP server resource.
     * Use this when you explicitly want to create a new resource
     * and want an error if it already exists.
     * Input: McpServer with metadata (scope, org, name/slug) and spec.
     * Returns: The created McpServer with system-generated ID and status.
     * Authorization: Custom authorization in handler.
     * Requires permission to create MCP servers in the specified scope:
     * - Platform: Requires platform operator role
     * - Organization: Requires org admin role or can_create_mcp_server permission
     * - Identity Account: Automatically allowed for the authenticated user
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> create(
        ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
     * Input: McpServer with metadata.id populated and updated spec.
     * Returns: The updated McpServer.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * Only the owner (based on scope) can update:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> update(
        ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an MCP server resource.
     * Permanently removes the MCP server definition.
     * Agents referencing this MCP server will need to be updated.
     * Input: ApiResourceDeleteInput with resource_id and optional version_message.
     * Returns: The deleted McpServer (for confirmation/audit).
     * Authorization: Requires can_delete permission on the mcp_server resource.
     * Only the owner can delete:
     * - Platform: Platform operators
     * - Organization: Org admins or resource owner
     * - Identity Account: The owner
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an MCP server publicly accessible (marketplace-style sharing) or to
     * revoke public access without sending the entire resource.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the discovered capabilities (tools and resource templates) for an MCP server.
     * This is a targeted status update — it only modifies status.discovered_capabilities,
     * leaving spec, validation state, and other status fields untouched.
     * Typical flow:
     * 1. CLI calls getByReference(org/slug) to fetch the McpServer and its ID
     * 2. CLI connects to the MCP server locally and queries tools/resources
     * 3. CLI calls this RPC with the ID and discovered capabilities
     * Input: UpdateDiscoveredCapabilitiesInput with mcp_server_id and discovered_capabilities.
     * Returns: The updated McpServer with the new discovered capabilities.
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> updateDiscoveredCapabilities(
        ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateDiscoveredCapabilitiesMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Discover the capabilities of an MCP server by connecting to it.
     * This triggers server-side discovery: the backend resolves credentials,
     * connects to the MCP server, enumerates tools and resource templates,
     * and stores the result.
     * The RPC blocks until discovery completes (up to ~30 seconds) and returns the
     * updated McpServer with populated status.discovered_capabilities.
     * &#64;internal
     * Typical flow:
     * 1. Web console ensures required credentials are saved in the user's personal environment
     * 2. Web console calls discoverCapabilities with the MCP server ID
     * 3. Backend resolves env vars from the user's personal environment
     * 4. Backend starts a Temporal workflow; agent-runner connects to the MCP server
     * 5. Discovered tools and resource templates are stored and returned
     * Input: DiscoverCapabilitiesInput with mcp_server_id.
     * Returns: The updated McpServer with discovered capabilities.
     * Errors:
     * - FAILED_PRECONDITION: Required credentials missing from personal environment
     * - DEADLINE_EXCEEDED: Discovery did not complete within the timeout
     * - NOT_FOUND: MCP server does not exist
     * Authorization: Requires can_edit permission on the mcp_server resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> discoverCapabilities(
        ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDiscoverCapabilitiesMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;
  private static final int METHODID_UPDATE_VISIBILITY = 4;
  private static final int METHODID_UPDATE_DISCOVERED_CAPABILITIES = 5;
  private static final int METHODID_DISCOVER_CAPABILITIES = 6;

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
          serviceImpl.apply((ai.stigmer.agentic.mcpserver.v1.McpServer) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.mcpserver.v1.McpServer) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.mcpserver.v1.McpServer) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_UPDATE_DISCOVERED_CAPABILITIES:
          serviceImpl.updateDiscoveredCapabilities((ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_DISCOVER_CAPABILITIES:
          serviceImpl.discoverCapabilities((ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
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
              ai.stigmer.agentic.mcpserver.v1.McpServer,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.McpServer,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.McpServer,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_DELETE)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getUpdateDiscoveredCapabilitiesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.UpdateDiscoveredCapabilitiesInput,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_UPDATE_DISCOVERED_CAPABILITIES)))
        .addMethod(
          getDiscoverCapabilitiesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.DiscoverCapabilitiesInput,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_DISCOVER_CAPABILITIES)))
        .build();
  }

  private static abstract class McpServerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    McpServerCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.mcpserver.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("McpServerCommandController");
    }
  }

  private static final class McpServerCommandControllerFileDescriptorSupplier
      extends McpServerCommandControllerBaseDescriptorSupplier {
    McpServerCommandControllerFileDescriptorSupplier() {}
  }

  private static final class McpServerCommandControllerMethodDescriptorSupplier
      extends McpServerCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    McpServerCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (McpServerCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new McpServerCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getUpdateDiscoveredCapabilitiesMethod())
              .addMethod(getDiscoverCapabilitiesMethod())
              .build();
        }
      }
    }
    return result;
  }
}
