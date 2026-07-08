package ai.stigmer.agentic.agent.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentCommandController handles write operations for AI agents.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentCommandControllerGrpc {

  private AgentCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agent.v1.AgentCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.Agent,
      ai.stigmer.agentic.agent.v1.Agent> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.agent.v1.Agent.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.Agent,
      ai.stigmer.agentic.agent.v1.Agent> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.Agent, ai.stigmer.agentic.agent.v1.Agent> getApplyMethod;
    if ((getApplyMethod = AgentCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (AgentCommandControllerGrpc.class) {
        if ((getApplyMethod = AgentCommandControllerGrpc.getApplyMethod) == null) {
          AgentCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.Agent, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.Agent,
      ai.stigmer.agentic.agent.v1.Agent> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.agent.v1.Agent.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.Agent,
      ai.stigmer.agentic.agent.v1.Agent> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.Agent, ai.stigmer.agentic.agent.v1.Agent> getCreateMethod;
    if ((getCreateMethod = AgentCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (AgentCommandControllerGrpc.class) {
        if ((getCreateMethod = AgentCommandControllerGrpc.getCreateMethod) == null) {
          AgentCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.Agent, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.Agent,
      ai.stigmer.agentic.agent.v1.Agent> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.agent.v1.Agent.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.Agent,
      ai.stigmer.agentic.agent.v1.Agent> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.Agent, ai.stigmer.agentic.agent.v1.Agent> getUpdateMethod;
    if ((getUpdateMethod = AgentCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (AgentCommandControllerGrpc.class) {
        if ((getUpdateMethod = AgentCommandControllerGrpc.getUpdateMethod) == null) {
          AgentCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.Agent, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.agent.v1.Agent> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.agent.v1.Agent> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.agent.v1.Agent> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = AgentCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (AgentCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = AgentCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          AgentCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput,
      ai.stigmer.agentic.agent.v1.Agent> getUpdateSharingMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateSharing",
      requestType = ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput,
      ai.stigmer.agentic.agent.v1.Agent> getUpdateSharingMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput, ai.stigmer.agentic.agent.v1.Agent> getUpdateSharingMethod;
    if ((getUpdateSharingMethod = AgentCommandControllerGrpc.getUpdateSharingMethod) == null) {
      synchronized (AgentCommandControllerGrpc.class) {
        if ((getUpdateSharingMethod = AgentCommandControllerGrpc.getUpdateSharingMethod) == null) {
          AgentCommandControllerGrpc.getUpdateSharingMethod = getUpdateSharingMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateSharing"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentCommandControllerMethodDescriptorSupplier("updateSharing"))
              .build();
        }
      }
    }
    return getUpdateSharingMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.AgentId,
      ai.stigmer.agentic.agent.v1.Agent> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.agent.v1.AgentId.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.AgentId,
      ai.stigmer.agentic.agent.v1.Agent> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.AgentId, ai.stigmer.agentic.agent.v1.Agent> getDeleteMethod;
    if ((getDeleteMethod = AgentCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (AgentCommandControllerGrpc.class) {
        if ((getDeleteMethod = AgentCommandControllerGrpc.getDeleteMethod) == null) {
          AgentCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.AgentId, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.AgentId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentCommandControllerStub>() {
        @java.lang.Override
        public AgentCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentCommandControllerStub(channel, callOptions);
        }
      };
    return AgentCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentCommandControllerBlockingStub>() {
        @java.lang.Override
        public AgentCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentCommandControllerFutureStub>() {
        @java.lang.Override
        public AgentCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentCommandControllerFutureStub(channel, callOptions);
        }
      };
    return AgentCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentCommandController handles write operations for AI agents.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an agent.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.agent.v1.Agent request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an agent.
     * &#64;internal
     * Authorization:
     * - Organization-scoped agents: Caller must have can_create_agent permission in the organization
     * - Platform-scoped agents: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    default void create(ai.stigmer.agentic.agent.v1.Agent request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent.
     * </pre>
     */
    default void update(ai.stigmer.agentic.agent.v1.Agent request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an agent publicly accessible or to revoke public access without
     * sending the entire agent resource (avoiding read-modify-write races).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the sharing configuration of an existing agent.
     * This is a targeted spec update — it only modifies spec.sharing, leaving
     * the rest of the spec, metadata, and status untouched. Use this to enable
     * or revoke anyone-with-link access to the agent's hosted chat without
     * sending the entire agent resource (avoiding read-modify-write races).
     * Sharing is a distinct consent from visibility: updateVisibility governs
     * who can read the blueprint (marketplace), updateSharing governs who can
     * chat with the runtime. Conversations over a shared link bill the owning
     * organization's credits.
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource —
     * the same bar as updateVisibility, since both broaden access.
     * No FGA tuples are written on share; enforcement is app-level in the
     * getSharedProfile handler (see AgentSharing in spec.proto).
     * </pre>
     */
    default void updateSharing(ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateSharingMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an agent.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.agent.v1.AgentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentCommandController.
   * <pre>
   * AgentCommandController handles write operations for AI agents.
   * </pre>
   */
  public static abstract class AgentCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentCommandController.
   * <pre>
   * AgentCommandController handles write operations for AI agents.
   * </pre>
   */
  public static final class AgentCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentCommandControllerStub> {
    private AgentCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.agent.v1.Agent request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an agent.
     * &#64;internal
     * Authorization:
     * - Organization-scoped agents: Caller must have can_create_agent permission in the organization
     * - Platform-scoped agents: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public void create(ai.stigmer.agentic.agent.v1.Agent request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent.
     * </pre>
     */
    public void update(ai.stigmer.agentic.agent.v1.Agent request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an agent publicly accessible or to revoke public access without
     * sending the entire agent resource (avoiding read-modify-write races).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the sharing configuration of an existing agent.
     * This is a targeted spec update — it only modifies spec.sharing, leaving
     * the rest of the spec, metadata, and status untouched. Use this to enable
     * or revoke anyone-with-link access to the agent's hosted chat without
     * sending the entire agent resource (avoiding read-modify-write races).
     * Sharing is a distinct consent from visibility: updateVisibility governs
     * who can read the blueprint (marketplace), updateSharing governs who can
     * chat with the runtime. Conversations over a shared link bill the owning
     * organization's credits.
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource —
     * the same bar as updateVisibility, since both broaden access.
     * No FGA tuples are written on share; enforcement is app-level in the
     * getSharedProfile handler (see AgentSharing in spec.proto).
     * </pre>
     */
    public void updateSharing(ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateSharingMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an agent.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.agent.v1.AgentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentCommandController.
   * <pre>
   * AgentCommandController handles write operations for AI agents.
   * </pre>
   */
  public static final class AgentCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentCommandControllerBlockingV2Stub> {
    private AgentCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent apply(ai.stigmer.agentic.agent.v1.Agent request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent.
     * &#64;internal
     * Authorization:
     * - Organization-scoped agents: Caller must have can_create_agent permission in the organization
     * - Platform-scoped agents: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent create(ai.stigmer.agentic.agent.v1.Agent request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent update(ai.stigmer.agentic.agent.v1.Agent request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an agent publicly accessible or to revoke public access without
     * sending the entire agent resource (avoiding read-modify-write races).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the sharing configuration of an existing agent.
     * This is a targeted spec update — it only modifies spec.sharing, leaving
     * the rest of the spec, metadata, and status untouched. Use this to enable
     * or revoke anyone-with-link access to the agent's hosted chat without
     * sending the entire agent resource (avoiding read-modify-write races).
     * Sharing is a distinct consent from visibility: updateVisibility governs
     * who can read the blueprint (marketplace), updateSharing governs who can
     * chat with the runtime. Conversations over a shared link bill the owning
     * organization's credits.
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource —
     * the same bar as updateVisibility, since both broaden access.
     * No FGA tuples are written on share; enforcement is app-level in the
     * getSharedProfile handler (see AgentSharing in spec.proto).
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent updateSharing(ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateSharingMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent delete(ai.stigmer.agentic.agent.v1.AgentId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentCommandController.
   * <pre>
   * AgentCommandController handles write operations for AI agents.
   * </pre>
   */
  public static final class AgentCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentCommandControllerBlockingStub> {
    private AgentCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent apply(ai.stigmer.agentic.agent.v1.Agent request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent.
     * &#64;internal
     * Authorization:
     * - Organization-scoped agents: Caller must have can_create_agent permission in the organization
     * - Platform-scoped agents: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent create(ai.stigmer.agentic.agent.v1.Agent request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent update(ai.stigmer.agentic.agent.v1.Agent request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an agent publicly accessible or to revoke public access without
     * sending the entire agent resource (avoiding read-modify-write races).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the sharing configuration of an existing agent.
     * This is a targeted spec update — it only modifies spec.sharing, leaving
     * the rest of the spec, metadata, and status untouched. Use this to enable
     * or revoke anyone-with-link access to the agent's hosted chat without
     * sending the entire agent resource (avoiding read-modify-write races).
     * Sharing is a distinct consent from visibility: updateVisibility governs
     * who can read the blueprint (marketplace), updateSharing governs who can
     * chat with the runtime. Conversations over a shared link bill the owning
     * organization's credits.
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource —
     * the same bar as updateVisibility, since both broaden access.
     * No FGA tuples are written on share; enforcement is app-level in the
     * getSharedProfile handler (see AgentSharing in spec.proto).
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent updateSharing(ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateSharingMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent delete(ai.stigmer.agentic.agent.v1.AgentId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentCommandController.
   * <pre>
   * AgentCommandController handles write operations for AI agents.
   * </pre>
   */
  public static final class AgentCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentCommandControllerFutureStub> {
    private AgentCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> apply(
        ai.stigmer.agentic.agent.v1.Agent request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an agent.
     * &#64;internal
     * Authorization:
     * - Organization-scoped agents: Caller must have can_create_agent permission in the organization
     * - Platform-scoped agents: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> create(
        ai.stigmer.agentic.agent.v1.Agent request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing agent.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> update(
        ai.stigmer.agentic.agent.v1.Agent request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make an agent publicly accessible or to revoke public access without
     * sending the entire agent resource (avoiding read-modify-write races).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the sharing configuration of an existing agent.
     * This is a targeted spec update — it only modifies spec.sharing, leaving
     * the rest of the spec, metadata, and status untouched. Use this to enable
     * or revoke anyone-with-link access to the agent's hosted chat without
     * sending the entire agent resource (avoiding read-modify-write races).
     * Sharing is a distinct consent from visibility: updateVisibility governs
     * who can read the blueprint (marketplace), updateSharing governs who can
     * chat with the runtime. Conversations over a shared link bill the owning
     * organization's credits.
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent resource —
     * the same bar as updateVisibility, since both broaden access.
     * No FGA tuples are written on share; enforcement is app-level in the
     * getSharedProfile handler (see AgentSharing in spec.proto).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> updateSharing(
        ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateSharingMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an agent.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> delete(
        ai.stigmer.agentic.agent.v1.AgentId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_UPDATE_SHARING = 4;
  private static final int METHODID_DELETE = 5;

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
          serviceImpl.apply((ai.stigmer.agentic.agent.v1.Agent) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.agent.v1.Agent) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.agent.v1.Agent) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_UPDATE_SHARING:
          serviceImpl.updateSharing((ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.agent.v1.AgentId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
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
              ai.stigmer.agentic.agent.v1.Agent,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agent.v1.Agent,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agent.v1.Agent,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getUpdateSharingMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agent.v1.UpdateAgentSharingInput,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_UPDATE_SHARING)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agent.v1.AgentId,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class AgentCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agent.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentCommandController");
    }
  }

  private static final class AgentCommandControllerFileDescriptorSupplier
      extends AgentCommandControllerBaseDescriptorSupplier {
    AgentCommandControllerFileDescriptorSupplier() {}
  }

  private static final class AgentCommandControllerMethodDescriptorSupplier
      extends AgentCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getUpdateSharingMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
