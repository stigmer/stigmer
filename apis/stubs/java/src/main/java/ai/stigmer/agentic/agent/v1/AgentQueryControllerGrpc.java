package ai.stigmer.agentic.agent.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentQueryController handles read operations for AI agents.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentQueryControllerGrpc {

  private AgentQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agent.v1.AgentQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.AgentId,
      ai.stigmer.agentic.agent.v1.Agent> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.agent.v1.AgentId.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.AgentId,
      ai.stigmer.agentic.agent.v1.Agent> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.AgentId, ai.stigmer.agentic.agent.v1.Agent> getGetMethod;
    if ((getGetMethod = AgentQueryControllerGrpc.getGetMethod) == null) {
      synchronized (AgentQueryControllerGrpc.class) {
        if ((getGetMethod = AgentQueryControllerGrpc.getGetMethod) == null) {
          AgentQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.AgentId, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.AgentId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agent.v1.Agent> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agent.v1.Agent> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agent.v1.Agent> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = AgentQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (AgentQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = AgentQueryControllerGrpc.getGetByReferenceMethod) == null) {
          AgentQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.ListAgentVersionsInput,
      ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse> getListVersionsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listVersions",
      requestType = ai.stigmer.agentic.agent.v1.ListAgentVersionsInput.class,
      responseType = ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.ListAgentVersionsInput,
      ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse> getListVersionsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.ListAgentVersionsInput, ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse> getListVersionsMethod;
    if ((getListVersionsMethod = AgentQueryControllerGrpc.getListVersionsMethod) == null) {
      synchronized (AgentQueryControllerGrpc.class) {
        if ((getListVersionsMethod = AgentQueryControllerGrpc.getListVersionsMethod) == null) {
          AgentQueryControllerGrpc.getListVersionsMethod = getListVersionsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.ListAgentVersionsInput, ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listVersions"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.ListAgentVersionsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentQueryControllerMethodDescriptorSupplier("listVersions"))
              .build();
        }
      }
    }
    return getListVersionsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.GetAgentVersionInput,
      ai.stigmer.agentic.agent.v1.AgentVersionEntry> getGetVersionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getVersion",
      requestType = ai.stigmer.agentic.agent.v1.GetAgentVersionInput.class,
      responseType = ai.stigmer.agentic.agent.v1.AgentVersionEntry.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.GetAgentVersionInput,
      ai.stigmer.agentic.agent.v1.AgentVersionEntry> getGetVersionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.GetAgentVersionInput, ai.stigmer.agentic.agent.v1.AgentVersionEntry> getGetVersionMethod;
    if ((getGetVersionMethod = AgentQueryControllerGrpc.getGetVersionMethod) == null) {
      synchronized (AgentQueryControllerGrpc.class) {
        if ((getGetVersionMethod = AgentQueryControllerGrpc.getGetVersionMethod) == null) {
          AgentQueryControllerGrpc.getGetVersionMethod = getGetVersionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.GetAgentVersionInput, ai.stigmer.agentic.agent.v1.AgentVersionEntry>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getVersion"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.GetAgentVersionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.AgentVersionEntry.getDefaultInstance()))
              .setSchemaDescriptor(new AgentQueryControllerMethodDescriptorSupplier("getVersion"))
              .build();
        }
      }
    }
    return getGetVersionMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerStub>() {
        @java.lang.Override
        public AgentQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentQueryControllerStub(channel, callOptions);
        }
      };
    return AgentQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerBlockingStub>() {
        @java.lang.Override
        public AgentQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentQueryControllerFutureStub>() {
        @java.lang.Override
        public AgentQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentQueryControllerFutureStub(channel, callOptions);
        }
      };
    return AgentQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.agent.v1.AgentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug) with version support.
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List version history for an agent.
     * Returns all historical versions, newest first. Each entry carries the
     * version hash, when and by whom it was applied, its tag, its message and
     * the full spec of that version.
     * </pre>
     */
    default void listVersions(ai.stigmer.agentic.agent.v1.ListAgentVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListVersionsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a specific version of an agent by its content hash.
     * Used by the runner and the server to run a turn on the version it
     * recorded (RunStatus.agent_version_hash), and by clients to
     * show what a past version said.
     * </pre>
     */
    default void getVersion(ai.stigmer.agentic.agent.v1.GetAgentVersionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.AgentVersionEntry> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetVersionMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static abstract class AgentQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static final class AgentQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentQueryControllerStub> {
    private AgentQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.agent.v1.AgentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug) with version support.
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List version history for an agent.
     * Returns all historical versions, newest first. Each entry carries the
     * version hash, when and by whom it was applied, its tag, its message and
     * the full spec of that version.
     * </pre>
     */
    public void listVersions(ai.stigmer.agentic.agent.v1.ListAgentVersionsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a specific version of an agent by its content hash.
     * Used by the runner and the server to run a turn on the version it
     * recorded (RunStatus.agent_version_hash), and by clients to
     * show what a past version said.
     * </pre>
     */
    public void getVersion(ai.stigmer.agentic.agent.v1.GetAgentVersionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.AgentVersionEntry> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetVersionMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static final class AgentQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentQueryControllerBlockingV2Stub> {
    private AgentQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent get(ai.stigmer.agentic.agent.v1.AgentId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug) with version support.
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List version history for an agent.
     * Returns all historical versions, newest first. Each entry carries the
     * version hash, when and by whom it was applied, its tag, its message and
     * the full spec of that version.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse listVersions(ai.stigmer.agentic.agent.v1.ListAgentVersionsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a specific version of an agent by its content hash.
     * Used by the runner and the server to run a turn on the version it
     * recorded (RunStatus.agent_version_hash), and by clients to
     * show what a past version said.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.AgentVersionEntry getVersion(ai.stigmer.agentic.agent.v1.GetAgentVersionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetVersionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static final class AgentQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentQueryControllerBlockingStub> {
    private AgentQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent get(ai.stigmer.agentic.agent.v1.AgentId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug) with version support.
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List version history for an agent.
     * Returns all historical versions, newest first. Each entry carries the
     * version hash, when and by whom it was applied, its tag, its message and
     * the full spec of that version.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse listVersions(ai.stigmer.agentic.agent.v1.ListAgentVersionsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListVersionsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a specific version of an agent by its content hash.
     * Used by the runner and the server to run a turn on the version it
     * recorded (RunStatus.agent_version_hash), and by clients to
     * show what a past version said.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.AgentVersionEntry getVersion(ai.stigmer.agentic.agent.v1.GetAgentVersionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetVersionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentQueryController.
   * <pre>
   * AgentQueryController handles read operations for AI agents.
   * </pre>
   */
  public static final class AgentQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentQueryControllerFutureStub> {
    private AgentQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> get(
        ai.stigmer.agentic.agent.v1.AgentId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an agent by its organization-scoped reference (org/slug) with version support.
     * Resolves a human-readable reference like "acme/web-search" to the full Agent resource.
     * Version resolution (via ApiResourceReference.version field):
     * - Empty/"latest" → Returns the current version
     * - Tag name (e.g., "stable", "v1.0") → Resolves to the version with this tag
     * - SHA256 hash (64 hex chars) → Returns the exact immutable version
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List version history for an agent.
     * Returns all historical versions, newest first. Each entry carries the
     * version hash, when and by whom it was applied, its tag, its message and
     * the full spec of that version.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse> listVersions(
        ai.stigmer.agentic.agent.v1.ListAgentVersionsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListVersionsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a specific version of an agent by its content hash.
     * Used by the runner and the server to run a turn on the version it
     * recorded (RunStatus.agent_version_hash), and by clients to
     * show what a past version said.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.AgentVersionEntry> getVersion(
        ai.stigmer.agentic.agent.v1.GetAgentVersionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetVersionMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST_VERSIONS = 2;
  private static final int METHODID_GET_VERSION = 3;

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
          serviceImpl.get((ai.stigmer.agentic.agent.v1.AgentId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_LIST_VERSIONS:
          serviceImpl.listVersions((ai.stigmer.agentic.agent.v1.ListAgentVersionsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse>) responseObserver);
          break;
        case METHODID_GET_VERSION:
          serviceImpl.getVersion((ai.stigmer.agentic.agent.v1.GetAgentVersionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.AgentVersionEntry>) responseObserver);
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
              ai.stigmer.agentic.agent.v1.AgentId,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListVersionsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agent.v1.ListAgentVersionsInput,
              ai.stigmer.agentic.agent.v1.ListAgentVersionsResponse>(
                service, METHODID_LIST_VERSIONS)))
        .addMethod(
          getGetVersionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agent.v1.GetAgentVersionInput,
              ai.stigmer.agentic.agent.v1.AgentVersionEntry>(
                service, METHODID_GET_VERSION)))
        .build();
  }

  private static abstract class AgentQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agent.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentQueryController");
    }
  }

  private static final class AgentQueryControllerFileDescriptorSupplier
      extends AgentQueryControllerBaseDescriptorSupplier {
    AgentQueryControllerFileDescriptorSupplier() {}
  }

  private static final class AgentQueryControllerMethodDescriptorSupplier
      extends AgentQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListVersionsMethod())
              .addMethod(getGetVersionMethod())
              .build();
        }
      }
    }
    return result;
  }
}
