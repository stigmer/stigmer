package ai.stigmer.agentic.mcpserver.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * McpServerCommandController provides write operations for MCP server resources.
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.ConnectInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getConnectMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "connect",
      requestType = ai.stigmer.agentic.mcpserver.v1.ConnectInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.ConnectInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getConnectMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.ConnectInput, ai.stigmer.agentic.mcpserver.v1.McpServer> getConnectMethod;
    if ((getConnectMethod = McpServerCommandControllerGrpc.getConnectMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getConnectMethod = McpServerCommandControllerGrpc.getConnectMethod) == null) {
          McpServerCommandControllerGrpc.getConnectMethod = getConnectMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.ConnectInput, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "connect"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.ConnectInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("connect"))
              .build();
        }
      }
    }
    return getConnectMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.ConnectInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getStartConnectMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "startConnect",
      requestType = ai.stigmer.agentic.mcpserver.v1.ConnectInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.McpServer.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.ConnectInput,
      ai.stigmer.agentic.mcpserver.v1.McpServer> getStartConnectMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.ConnectInput, ai.stigmer.agentic.mcpserver.v1.McpServer> getStartConnectMethod;
    if ((getStartConnectMethod = McpServerCommandControllerGrpc.getStartConnectMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getStartConnectMethod = McpServerCommandControllerGrpc.getStartConnectMethod) == null) {
          McpServerCommandControllerGrpc.getStartConnectMethod = getStartConnectMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.ConnectInput, ai.stigmer.agentic.mcpserver.v1.McpServer>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "startConnect"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.ConnectInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.McpServer.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("startConnect"))
              .build();
        }
      }
    }
    return getStartConnectMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput,
      ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> getDisconnectOAuthMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "disconnectOAuth",
      requestType = ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput.class,
      responseType = ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput,
      ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> getDisconnectOAuthMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput, ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> getDisconnectOAuthMethod;
    if ((getDisconnectOAuthMethod = McpServerCommandControllerGrpc.getDisconnectOAuthMethod) == null) {
      synchronized (McpServerCommandControllerGrpc.class) {
        if ((getDisconnectOAuthMethod = McpServerCommandControllerGrpc.getDisconnectOAuthMethod) == null) {
          McpServerCommandControllerGrpc.getDisconnectOAuthMethod = getDisconnectOAuthMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput, ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "disconnectOAuth"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput.getDefaultInstance()))
              .setSchemaDescriptor(new McpServerCommandControllerMethodDescriptorSupplier("disconnectOAuth"))
              .build();
        }
      }
    }
    return getDisconnectOAuthMethod;
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
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
     * </pre>
     */
    default void create(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
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
     * Agents referencing this server will need to be updated.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Connect to an MCP server and discover its tools.
     * Connects to the MCP server, enumerates tools and resource templates,
     * records which tools the server marks destructive, and stores the
     * results in status.discovered_capabilities.
     * Blocks until the operation settles — legitimately minutes for heavy
     * stdio servers (the server-side workflow ceiling is the bound) — and
     * returns the updated McpServer.
     * Prefer startConnect for interactive clients: browsers can drop a
     * no-bytes-yet unary response around ~300s, below the workflow ceiling,
     * so a blocking connect can appear to fail while succeeding server-side.
     * This RPC remains for callers that want synchronous semantics (and for
     * backends that do not yet serve startConnect).
     * </pre>
     */
    default void connect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getConnectMethod(), responseObserver);
    }

    /**
     * <pre>
     * Start a connect operation without waiting for it: discovery runs
     * server-side, and the caller observes progress by
     * polling the resource.
     * Returns the McpServer immediately with status.connect_status describing
     * the accepted operation (phase CONNECTING, plus a warning when no runner
     * appears to be polling the task queue). Poll get/getByReference until
     * status.connect_status reaches a terminal phase; results land in
     * status.discovered_capabilities exactly as with the blocking connect.
     * Idempotent while an operation is in flight: a startConnect that finds a
     * live CONNECTING operation attaches to it (the in-flight operation's
     * values serve it) instead of starting a second workflow. A CONNECTING
     * entry orphaned by a backend restart is reconciled against Temporal
     * before a new operation starts.
     * </pre>
     */
    default void startConnect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getStartConnectMethod(), responseObserver);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's sign-in for an MCP server.
     * Removes the sign-in saved at the server's address in the caller's My
     * vault, with its access and refresh tokens. The MCP server definition is
     * unchanged. A pasted login at the address is left in place, and so is a
     * sign-in saved into a shared vault: the vault's removeConnections removes
     * either.
     * Idempotent: returns disconnected=true when a sign-in was removed,
     * disconnected=false when none was saved. Never returns an error
     * for a missing sign-in.
     * </pre>
     */
    default void disconnectOAuth(ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDisconnectOAuthMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
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
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.mcpserver.v1.McpServer request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
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
     * Agents referencing this server will need to be updated.
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
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Connect to an MCP server and discover its tools.
     * Connects to the MCP server, enumerates tools and resource templates,
     * records which tools the server marks destructive, and stores the
     * results in status.discovered_capabilities.
     * Blocks until the operation settles — legitimately minutes for heavy
     * stdio servers (the server-side workflow ceiling is the bound) — and
     * returns the updated McpServer.
     * Prefer startConnect for interactive clients: browsers can drop a
     * no-bytes-yet unary response around ~300s, below the workflow ceiling,
     * so a blocking connect can appear to fail while succeeding server-side.
     * This RPC remains for callers that want synchronous semantics (and for
     * backends that do not yet serve startConnect).
     * </pre>
     */
    public void connect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getConnectMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Start a connect operation without waiting for it: discovery runs
     * server-side, and the caller observes progress by
     * polling the resource.
     * Returns the McpServer immediately with status.connect_status describing
     * the accepted operation (phase CONNECTING, plus a warning when no runner
     * appears to be polling the task queue). Poll get/getByReference until
     * status.connect_status reaches a terminal phase; results land in
     * status.discovered_capabilities exactly as with the blocking connect.
     * Idempotent while an operation is in flight: a startConnect that finds a
     * live CONNECTING operation attaches to it (the in-flight operation's
     * values serve it) instead of starting a second workflow. A CONNECTING
     * entry orphaned by a backend restart is reconciled against Temporal
     * before a new operation starts.
     * </pre>
     */
    public void startConnect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getStartConnectMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's sign-in for an MCP server.
     * Removes the sign-in saved at the server's address in the caller's My
     * vault, with its access and refresh tokens. The MCP server definition is
     * unchanged. A pasted login at the address is left in place, and so is a
     * sign-in saved into a shared vault: the vault's removeConnections removes
     * either.
     * Idempotent: returns disconnected=true when a sign-in was removed,
     * disconnected=false when none was saved. Never returns an error
     * for a missing sign-in.
     * </pre>
     */
    public void disconnectOAuth(ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDisconnectOAuthMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
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
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer apply(ai.stigmer.agentic.mcpserver.v1.McpServer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer create(ai.stigmer.agentic.mcpserver.v1.McpServer request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
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
     * Agents referencing this server will need to be updated.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Connect to an MCP server and discover its tools.
     * Connects to the MCP server, enumerates tools and resource templates,
     * records which tools the server marks destructive, and stores the
     * results in status.discovered_capabilities.
     * Blocks until the operation settles — legitimately minutes for heavy
     * stdio servers (the server-side workflow ceiling is the bound) — and
     * returns the updated McpServer.
     * Prefer startConnect for interactive clients: browsers can drop a
     * no-bytes-yet unary response around ~300s, below the workflow ceiling,
     * so a blocking connect can appear to fail while succeeding server-side.
     * This RPC remains for callers that want synchronous semantics (and for
     * backends that do not yet serve startConnect).
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer connect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start a connect operation without waiting for it: discovery runs
     * server-side, and the caller observes progress by
     * polling the resource.
     * Returns the McpServer immediately with status.connect_status describing
     * the accepted operation (phase CONNECTING, plus a warning when no runner
     * appears to be polling the task queue). Poll get/getByReference until
     * status.connect_status reaches a terminal phase; results land in
     * status.discovered_capabilities exactly as with the blocking connect.
     * Idempotent while an operation is in flight: a startConnect that finds a
     * live CONNECTING operation attaches to it (the in-flight operation's
     * values serve it) instead of starting a second workflow. A CONNECTING
     * entry orphaned by a backend restart is reconciled against Temporal
     * before a new operation starts.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer startConnect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getStartConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's sign-in for an MCP server.
     * Removes the sign-in saved at the server's address in the caller's My
     * vault, with its access and refresh tokens. The MCP server definition is
     * unchanged. A pasted login at the address is left in place, and so is a
     * sign-in saved into a shared vault: the vault's removeConnections removes
     * either.
     * Idempotent: returns disconnected=true when a sign-in was removed,
     * disconnected=false when none was saved. Never returns an error
     * for a missing sign-in.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput disconnectOAuth(ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDisconnectOAuthMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
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
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer apply(ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer create(ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing MCP server resource.
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
     * Agents referencing this server will need to be updated.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing MCP server.
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Connect to an MCP server and discover its tools.
     * Connects to the MCP server, enumerates tools and resource templates,
     * records which tools the server marks destructive, and stores the
     * results in status.discovered_capabilities.
     * Blocks until the operation settles — legitimately minutes for heavy
     * stdio servers (the server-side workflow ceiling is the bound) — and
     * returns the updated McpServer.
     * Prefer startConnect for interactive clients: browsers can drop a
     * no-bytes-yet unary response around ~300s, below the workflow ceiling,
     * so a blocking connect can appear to fail while succeeding server-side.
     * This RPC remains for callers that want synchronous semantics (and for
     * backends that do not yet serve startConnect).
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer connect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Start a connect operation without waiting for it: discovery runs
     * server-side, and the caller observes progress by
     * polling the resource.
     * Returns the McpServer immediately with status.connect_status describing
     * the accepted operation (phase CONNECTING, plus a warning when no runner
     * appears to be polling the task queue). Poll get/getByReference until
     * status.connect_status reaches a terminal phase; results land in
     * status.discovered_capabilities exactly as with the blocking connect.
     * Idempotent while an operation is in flight: a startConnect that finds a
     * live CONNECTING operation attaches to it (the in-flight operation's
     * values serve it) instead of starting a second workflow. A CONNECTING
     * entry orphaned by a backend restart is reconciled against Temporal
     * before a new operation starts.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.McpServer startConnect(ai.stigmer.agentic.mcpserver.v1.ConnectInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getStartConnectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's sign-in for an MCP server.
     * Removes the sign-in saved at the server's address in the caller's My
     * vault, with its access and refresh tokens. The MCP server definition is
     * unchanged. A pasted login at the address is left in place, and so is a
     * sign-in saved into a shared vault: the vault's removeConnections removes
     * either.
     * Idempotent: returns disconnected=true when a sign-in was removed,
     * disconnected=false when none was saved. Never returns an error
     * for a missing sign-in.
     * </pre>
     */
    public ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput disconnectOAuth(ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDisconnectOAuthMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service McpServerCommandController.
   * <pre>
   * McpServerCommandController provides write operations for MCP server resources.
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
     * Create or update an MCP server resource.
     * If the resource doesn't exist, creates it. If it exists, updates it.
     * The resource is identified by its (scope, org, slug) combination.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> apply(
        ai.stigmer.agentic.mcpserver.v1.McpServer request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an MCP server resource.
     * Returns an error if a resource with the same (scope, org, slug) already exists.
     * Use `apply` for idempotent create-or-update semantics.
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
     * Agents referencing this server will need to be updated.
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
     * Only modifies metadata.visibility, leaving spec, status, and other
     * metadata fields untouched.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Connect to an MCP server and discover its tools.
     * Connects to the MCP server, enumerates tools and resource templates,
     * records which tools the server marks destructive, and stores the
     * results in status.discovered_capabilities.
     * Blocks until the operation settles — legitimately minutes for heavy
     * stdio servers (the server-side workflow ceiling is the bound) — and
     * returns the updated McpServer.
     * Prefer startConnect for interactive clients: browsers can drop a
     * no-bytes-yet unary response around ~300s, below the workflow ceiling,
     * so a blocking connect can appear to fail while succeeding server-side.
     * This RPC remains for callers that want synchronous semantics (and for
     * backends that do not yet serve startConnect).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> connect(
        ai.stigmer.agentic.mcpserver.v1.ConnectInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getConnectMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Start a connect operation without waiting for it: discovery runs
     * server-side, and the caller observes progress by
     * polling the resource.
     * Returns the McpServer immediately with status.connect_status describing
     * the accepted operation (phase CONNECTING, plus a warning when no runner
     * appears to be polling the task queue). Poll get/getByReference until
     * status.connect_status reaches a terminal phase; results land in
     * status.discovered_capabilities exactly as with the blocking connect.
     * Idempotent while an operation is in flight: a startConnect that finds a
     * live CONNECTING operation attaches to it (the in-flight operation's
     * values serve it) instead of starting a second workflow. A CONNECTING
     * entry orphaned by a backend restart is reconciled against Temporal
     * before a new operation starts.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.McpServer> startConnect(
        ai.stigmer.agentic.mcpserver.v1.ConnectInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getStartConnectMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Disconnect the authenticated user's sign-in for an MCP server.
     * Removes the sign-in saved at the server's address in the caller's My
     * vault, with its access and refresh tokens. The MCP server definition is
     * unchanged. A pasted login at the address is left in place, and so is a
     * sign-in saved into a shared vault: the vault's removeConnections removes
     * either.
     * Idempotent: returns disconnected=true when a sign-in was removed,
     * disconnected=false when none was saved. Never returns an error
     * for a missing sign-in.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput> disconnectOAuth(
        ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDisconnectOAuthMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;
  private static final int METHODID_UPDATE_VISIBILITY = 4;
  private static final int METHODID_CONNECT = 5;
  private static final int METHODID_START_CONNECT = 6;
  private static final int METHODID_DISCONNECT_OAUTH = 7;

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
        case METHODID_CONNECT:
          serviceImpl.connect((ai.stigmer.agentic.mcpserver.v1.ConnectInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_START_CONNECT:
          serviceImpl.startConnect((ai.stigmer.agentic.mcpserver.v1.ConnectInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.McpServer>) responseObserver);
          break;
        case METHODID_DISCONNECT_OAUTH:
          serviceImpl.disconnectOAuth((ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput>) responseObserver);
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
          getConnectMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.ConnectInput,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_CONNECT)))
        .addMethod(
          getStartConnectMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.ConnectInput,
              ai.stigmer.agentic.mcpserver.v1.McpServer>(
                service, METHODID_START_CONNECT)))
        .addMethod(
          getDisconnectOAuthMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthInput,
              ai.stigmer.agentic.mcpserver.v1.DisconnectOAuthOutput>(
                service, METHODID_DISCONNECT_OAUTH)))
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
              .addMethod(getConnectMethod())
              .addMethod(getStartConnectMethod())
              .addMethod(getDisconnectOAuthMethod())
              .build();
        }
      }
    }
    return result;
  }
}
