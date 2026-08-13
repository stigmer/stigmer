package ai.stigmer.agentic.agentinstance.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentInstanceCommandController handles write operations for agent instances.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentInstanceCommandControllerGrpc {

  private AgentInstanceCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentinstance.v1.AgentInstanceCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstance,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      responseType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstance,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstance, ai.stigmer.agentic.agentinstance.v1.AgentInstance> getApplyMethod;
    if ((getApplyMethod = AgentInstanceCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (AgentInstanceCommandControllerGrpc.class) {
        if ((getApplyMethod = AgentInstanceCommandControllerGrpc.getApplyMethod) == null) {
          AgentInstanceCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentinstance.v1.AgentInstance, ai.stigmer.agentic.agentinstance.v1.AgentInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setSchemaDescriptor(new AgentInstanceCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstance,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      responseType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstance,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstance, ai.stigmer.agentic.agentinstance.v1.AgentInstance> getCreateMethod;
    if ((getCreateMethod = AgentInstanceCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (AgentInstanceCommandControllerGrpc.class) {
        if ((getCreateMethod = AgentInstanceCommandControllerGrpc.getCreateMethod) == null) {
          AgentInstanceCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentinstance.v1.AgentInstance, ai.stigmer.agentic.agentinstance.v1.AgentInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setSchemaDescriptor(new AgentInstanceCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstance,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      responseType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstance,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstance, ai.stigmer.agentic.agentinstance.v1.AgentInstance> getUpdateMethod;
    if ((getUpdateMethod = AgentInstanceCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (AgentInstanceCommandControllerGrpc.class) {
        if ((getUpdateMethod = AgentInstanceCommandControllerGrpc.getUpdateMethod) == null) {
          AgentInstanceCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentinstance.v1.AgentInstance, ai.stigmer.agentic.agentinstance.v1.AgentInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setSchemaDescriptor(new AgentInstanceCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.agentinstance.v1.AgentInstance> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = AgentInstanceCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (AgentInstanceCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = AgentInstanceCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          AgentInstanceCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.agentinstance.v1.AgentInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setSchemaDescriptor(new AgentInstanceCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstanceId,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.agentinstance.v1.AgentInstanceId.class,
      responseType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstanceId,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstanceId, ai.stigmer.agentic.agentinstance.v1.AgentInstance> getDeleteMethod;
    if ((getDeleteMethod = AgentInstanceCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (AgentInstanceCommandControllerGrpc.class) {
        if ((getDeleteMethod = AgentInstanceCommandControllerGrpc.getDeleteMethod) == null) {
          AgentInstanceCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentinstance.v1.AgentInstanceId, ai.stigmer.agentic.agentinstance.v1.AgentInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstanceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setSchemaDescriptor(new AgentInstanceCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentInstanceCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentInstanceCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentInstanceCommandControllerStub>() {
        @java.lang.Override
        public AgentInstanceCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentInstanceCommandControllerStub(channel, callOptions);
        }
      };
    return AgentInstanceCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentInstanceCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentInstanceCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentInstanceCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentInstanceCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentInstanceCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentInstanceCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentInstanceCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentInstanceCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentInstanceCommandControllerBlockingStub>() {
        @java.lang.Override
        public AgentInstanceCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentInstanceCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentInstanceCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentInstanceCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentInstanceCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentInstanceCommandControllerFutureStub>() {
        @java.lang.Override
        public AgentInstanceCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentInstanceCommandControllerFutureStub(channel, callOptions);
        }
      };
    return AgentInstanceCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentInstanceCommandController handles write operations for agent instances.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an agent instance.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.agentinstance.v1.AgentInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an agent instance.
     * Public agents allow any authenticated user to create instances (cross-org allowed).
     * Private agents restrict instance creation to org members and the agent owner.
     * &#64;internal
     * Provide organization_id in metadata.org, and complete spec with configuration and secrets.
     * Authorization: FGA can_create_instance on parent agent (handler-level).
     * FGA is the single source of truth — no hardcoded org-matching rules.
     * Agents are blueprints with zero secrets; instances are personal resources in the caller's org.
     * </pre>
     */
    default void create(ai.stigmer.agentic.agentinstance.v1.AgentInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent instance.
     * &#64;internal
     * Replaces the entire instance configuration including metadata, spec, and secrets.
     * No individual field updates — always provide complete state.
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.name, metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.agent_id, metadata.id, metadata.org
     * Authorization: Only owner can update (can_edit permission).
     * </pre>
     */
    default void update(ai.stigmer.agentic.agentinstance.v1.AgentInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent instance.
     * Changes who can view this instance and interact with it. Supports the
     * full visibility spectrum: PRIVATE (owner only), ORG (all org members),
     * or PUBLIC (all authenticated users).
     * For agent instances, visibility controls who can create sessions and run
     * executions against this instance. Sessions remain personal regardless of
     * instance visibility (conversation privacy is preserved).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates agent_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates agent_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an agent instance.
     * &#64;internal
     * Authorization: Only owner can delete (can_delete permission).
     * </pre>
     */
    default void delete(ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentInstanceCommandController.
   * <pre>
   * AgentInstanceCommandController handles write operations for agent instances.
   * </pre>
   */
  public static abstract class AgentInstanceCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentInstanceCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentInstanceCommandController.
   * <pre>
   * AgentInstanceCommandController handles write operations for agent instances.
   * </pre>
   */
  public static final class AgentInstanceCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentInstanceCommandControllerStub> {
    private AgentInstanceCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentInstanceCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentInstanceCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent instance.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.agentinstance.v1.AgentInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an agent instance.
     * Public agents allow any authenticated user to create instances (cross-org allowed).
     * Private agents restrict instance creation to org members and the agent owner.
     * &#64;internal
     * Provide organization_id in metadata.org, and complete spec with configuration and secrets.
     * Authorization: FGA can_create_instance on parent agent (handler-level).
     * FGA is the single source of truth — no hardcoded org-matching rules.
     * Agents are blueprints with zero secrets; instances are personal resources in the caller's org.
     * </pre>
     */
    public void create(ai.stigmer.agentic.agentinstance.v1.AgentInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing agent instance.
     * &#64;internal
     * Replaces the entire instance configuration including metadata, spec, and secrets.
     * No individual field updates — always provide complete state.
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.name, metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.agent_id, metadata.id, metadata.org
     * Authorization: Only owner can update (can_edit permission).
     * </pre>
     */
    public void update(ai.stigmer.agentic.agentinstance.v1.AgentInstance request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent instance.
     * Changes who can view this instance and interact with it. Supports the
     * full visibility spectrum: PRIVATE (owner only), ORG (all org members),
     * or PUBLIC (all authenticated users).
     * For agent instances, visibility controls who can create sessions and run
     * executions against this instance. Sessions remain personal regardless of
     * instance visibility (conversation privacy is preserved).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates agent_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates agent_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an agent instance.
     * &#64;internal
     * Authorization: Only owner can delete (can_delete permission).
     * </pre>
     */
    public void delete(ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentInstanceCommandController.
   * <pre>
   * AgentInstanceCommandController handles write operations for agent instances.
   * </pre>
   */
  public static final class AgentInstanceCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentInstanceCommandControllerBlockingV2Stub> {
    private AgentInstanceCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentInstanceCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentInstanceCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent instance.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance apply(ai.stigmer.agentic.agentinstance.v1.AgentInstance request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent instance.
     * Public agents allow any authenticated user to create instances (cross-org allowed).
     * Private agents restrict instance creation to org members and the agent owner.
     * &#64;internal
     * Provide organization_id in metadata.org, and complete spec with configuration and secrets.
     * Authorization: FGA can_create_instance on parent agent (handler-level).
     * FGA is the single source of truth — no hardcoded org-matching rules.
     * Agents are blueprints with zero secrets; instances are personal resources in the caller's org.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance create(ai.stigmer.agentic.agentinstance.v1.AgentInstance request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent instance.
     * &#64;internal
     * Replaces the entire instance configuration including metadata, spec, and secrets.
     * No individual field updates — always provide complete state.
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.name, metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.agent_id, metadata.id, metadata.org
     * Authorization: Only owner can update (can_edit permission).
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance update(ai.stigmer.agentic.agentinstance.v1.AgentInstance request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent instance.
     * Changes who can view this instance and interact with it. Supports the
     * full visibility spectrum: PRIVATE (owner only), ORG (all org members),
     * or PUBLIC (all authenticated users).
     * For agent instances, visibility controls who can create sessions and run
     * executions against this instance. Sessions remain personal regardless of
     * instance visibility (conversation privacy is preserved).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates agent_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates agent_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent instance.
     * &#64;internal
     * Authorization: Only owner can delete (can_delete permission).
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance delete(ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentInstanceCommandController.
   * <pre>
   * AgentInstanceCommandController handles write operations for agent instances.
   * </pre>
   */
  public static final class AgentInstanceCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentInstanceCommandControllerBlockingStub> {
    private AgentInstanceCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentInstanceCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentInstanceCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent instance.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance apply(ai.stigmer.agentic.agentinstance.v1.AgentInstance request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent instance.
     * Public agents allow any authenticated user to create instances (cross-org allowed).
     * Private agents restrict instance creation to org members and the agent owner.
     * &#64;internal
     * Provide organization_id in metadata.org, and complete spec with configuration and secrets.
     * Authorization: FGA can_create_instance on parent agent (handler-level).
     * FGA is the single source of truth — no hardcoded org-matching rules.
     * Agents are blueprints with zero secrets; instances are personal resources in the caller's org.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance create(ai.stigmer.agentic.agentinstance.v1.AgentInstance request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing agent instance.
     * &#64;internal
     * Replaces the entire instance configuration including metadata, spec, and secrets.
     * No individual field updates — always provide complete state.
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.name, metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.agent_id, metadata.id, metadata.org
     * Authorization: Only owner can update (can_edit permission).
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance update(ai.stigmer.agentic.agentinstance.v1.AgentInstance request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent instance.
     * Changes who can view this instance and interact with it. Supports the
     * full visibility spectrum: PRIVATE (owner only), ORG (all org members),
     * or PUBLIC (all authenticated users).
     * For agent instances, visibility controls who can create sessions and run
     * executions against this instance. Sessions remain personal regardless of
     * instance visibility (conversation privacy is preserved).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates agent_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates agent_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent instance.
     * &#64;internal
     * Authorization: Only owner can delete (can_delete permission).
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance delete(ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentInstanceCommandController.
   * <pre>
   * AgentInstanceCommandController handles write operations for agent instances.
   * </pre>
   */
  public static final class AgentInstanceCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentInstanceCommandControllerFutureStub> {
    private AgentInstanceCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentInstanceCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentInstanceCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an agent instance.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the agent instance
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentinstance.v1.AgentInstance> apply(
        ai.stigmer.agentic.agentinstance.v1.AgentInstance request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an agent instance.
     * Public agents allow any authenticated user to create instances (cross-org allowed).
     * Private agents restrict instance creation to org members and the agent owner.
     * &#64;internal
     * Provide organization_id in metadata.org, and complete spec with configuration and secrets.
     * Authorization: FGA can_create_instance on parent agent (handler-level).
     * FGA is the single source of truth — no hardcoded org-matching rules.
     * Agents are blueprints with zero secrets; instances are personal resources in the caller's org.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentinstance.v1.AgentInstance> create(
        ai.stigmer.agentic.agentinstance.v1.AgentInstance request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing agent instance.
     * &#64;internal
     * Replaces the entire instance configuration including metadata, spec, and secrets.
     * No individual field updates — always provide complete state.
     * Mutable fields:
     * - spec.description, spec.environment_refs
     * - metadata.name, metadata.labels, metadata.tags, metadata.annotations
     * Immutable fields (must delete and recreate to change):
     * - spec.agent_id, metadata.id, metadata.org
     * Authorization: Only owner can update (can_edit permission).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentinstance.v1.AgentInstance> update(
        ai.stigmer.agentic.agentinstance.v1.AgentInstance request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent instance.
     * Changes who can view this instance and interact with it. Supports the
     * full visibility spectrum: PRIVATE (owner only), ORG (all org members),
     * or PUBLIC (all authenticated users).
     * For agent instances, visibility controls who can create sessions and run
     * executions against this instance. Sessions remain personal regardless of
     * instance visibility (conversation privacy is preserved).
     * &#64;internal
     * Authorization: Requires can_edit permission on the agent instance.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → ORG: creates agent_instance#viewer&#64;organization:&lt;org&gt;#member
     * - PRIVATE → PUBLIC: creates agent_instance#viewer&#64;identity_account:*
     * - ORG → PRIVATE: deletes the org member viewer tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentinstance.v1.AgentInstance> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an agent instance.
     * &#64;internal
     * Authorization: Only owner can delete (can_delete permission).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentinstance.v1.AgentInstance> delete(
        ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_DELETE = 4;

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
          serviceImpl.apply((ai.stigmer.agentic.agentinstance.v1.AgentInstance) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.agentinstance.v1.AgentInstance) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.agentinstance.v1.AgentInstance) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.agentinstance.v1.AgentInstanceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance>) responseObserver);
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
              ai.stigmer.agentic.agentinstance.v1.AgentInstance,
              ai.stigmer.agentic.agentinstance.v1.AgentInstance>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentinstance.v1.AgentInstance,
              ai.stigmer.agentic.agentinstance.v1.AgentInstance>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentinstance.v1.AgentInstance,
              ai.stigmer.agentic.agentinstance.v1.AgentInstance>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.agentinstance.v1.AgentInstance>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentinstance.v1.AgentInstanceId,
              ai.stigmer.agentic.agentinstance.v1.AgentInstance>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class AgentInstanceCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentInstanceCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentinstance.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentInstanceCommandController");
    }
  }

  private static final class AgentInstanceCommandControllerFileDescriptorSupplier
      extends AgentInstanceCommandControllerBaseDescriptorSupplier {
    AgentInstanceCommandControllerFileDescriptorSupplier() {}
  }

  private static final class AgentInstanceCommandControllerMethodDescriptorSupplier
      extends AgentInstanceCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentInstanceCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentInstanceCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentInstanceCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
