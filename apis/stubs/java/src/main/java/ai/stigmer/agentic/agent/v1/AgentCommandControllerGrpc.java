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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.UpdateAgentInput,
      ai.stigmer.agentic.agent.v1.Agent> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.agent.v1.UpdateAgentInput.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.UpdateAgentInput,
      ai.stigmer.agentic.agent.v1.Agent> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.UpdateAgentInput, ai.stigmer.agentic.agent.v1.Agent> getUpdateMethod;
    if ((getUpdateMethod = AgentCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (AgentCommandControllerGrpc.class) {
        if ((getUpdateMethod = AgentCommandControllerGrpc.getUpdateMethod) == null) {
          AgentCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.UpdateAgentInput, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.UpdateAgentInput.getDefaultInstance()))
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.agent.v1.Agent> getRenameMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rename",
      requestType = ai.stigmer.commons.apiresource.RenameInput.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.agent.v1.Agent> getRenameMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.agent.v1.Agent> getRenameMethod;
    if ((getRenameMethod = AgentCommandControllerGrpc.getRenameMethod) == null) {
      synchronized (AgentCommandControllerGrpc.class) {
        if ((getRenameMethod = AgentCommandControllerGrpc.getRenameMethod) == null) {
          AgentCommandControllerGrpc.getRenameMethod = getRenameMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rename"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.RenameInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentCommandControllerMethodDescriptorSupplier("rename"))
              .build();
        }
      }
    }
    return getRenameMethod;
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.TagAgentVersionInput,
      ai.stigmer.agentic.agent.v1.Agent> getTagVersionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "tagVersion",
      requestType = ai.stigmer.agentic.agent.v1.TagAgentVersionInput.class,
      responseType = ai.stigmer.agentic.agent.v1.Agent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.TagAgentVersionInput,
      ai.stigmer.agentic.agent.v1.Agent> getTagVersionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agent.v1.TagAgentVersionInput, ai.stigmer.agentic.agent.v1.Agent> getTagVersionMethod;
    if ((getTagVersionMethod = AgentCommandControllerGrpc.getTagVersionMethod) == null) {
      synchronized (AgentCommandControllerGrpc.class) {
        if ((getTagVersionMethod = AgentCommandControllerGrpc.getTagVersionMethod) == null) {
          AgentCommandControllerGrpc.getTagVersionMethod = getTagVersionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agent.v1.TagAgentVersionInput, ai.stigmer.agentic.agent.v1.Agent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "tagVersion"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.TagAgentVersionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agent.v1.Agent.getDefaultInstance()))
              .setSchemaDescriptor(new AgentCommandControllerMethodDescriptorSupplier("tagVersion"))
              .build();
        }
      }
    }
    return getTagVersionMethod;
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
     * A request that carries metadata.id of an agent in its organization updates
     * that agent, and its slug changes only through rename. A slug the agent was
     * renamed away from, named without the agent's id, is refused with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second agent:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same agent
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
     * </pre>
     */
    default void apply(ai.stigmer.agentic.agent.v1.Agent request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an agent.
     * A slug another agent of the organization holds is refused with
     * ALREADY_EXISTS. A slug another agent was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another agent held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    default void create(ai.stigmer.agentic.agent.v1.Agent request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an agent: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the agent; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the agent does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the agent changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the agent kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    default void update(ai.stigmer.agentic.agent.v1.UpdateAgentInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * widen or narrow who can read the agent without sending the entire agent
     * resource (avoiding read-modify-write races).
     * Raising the level is refused while a skill, plugin or agent the
     * agent references is less visible than the requested level: what a
     * person can run they must also be able to read.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rename an agent: change its slug, the name people type.
     * The agent keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * agent for reading for 30 days, during which no other agent of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another agent holds is refused with ALREADY_EXISTS, and one
     * another agent was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedules, channels, conversations and the agents that hand work to it
     * name it by id; a parent agent's turns call it by its new slug.
     * </pre>
     */
    default void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRenameMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an agent.
     * Deletion also removes the agent's version history and every channel in
     * the agent's own organization that serves it (its chat links and its
     * Slack and WhatsApp connections, whose installs are torn down first), so
     * a later agent created at the same org/slug starts clean. A teardown
     * that fails refuses the delete and keeps the agent and that channel, so
     * a retry finishes it. Sessions on the agent are not deleted: their next
     * message fails, naming the agent. Nor is a chat link written in another
     * organization before sharing across organizations was retired; such a
     * link stops resolving instead.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.agent.v1.AgentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific agent version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * </pre>
     */
    default void tagVersion(ai.stigmer.agentic.agent.v1.TagAgentVersionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getTagVersionMethod(), responseObserver);
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
     * A request that carries metadata.id of an agent in its organization updates
     * that agent, and its slug changes only through rename. A slug the agent was
     * renamed away from, named without the agent's id, is refused with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second agent:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same agent
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
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
     * A slug another agent of the organization holds is refused with
     * ALREADY_EXISTS. A slug another agent was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another agent held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    public void create(ai.stigmer.agentic.agent.v1.Agent request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an agent: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the agent; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the agent does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the agent changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the agent kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public void update(ai.stigmer.agentic.agent.v1.UpdateAgentInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * widen or narrow who can read the agent without sending the entire agent
     * resource (avoiding read-modify-write races).
     * Raising the level is refused while a skill, plugin or agent the
     * agent references is less visible than the requested level: what a
     * person can run they must also be able to read.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rename an agent: change its slug, the name people type.
     * The agent keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * agent for reading for 30 days, during which no other agent of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another agent holds is refused with ALREADY_EXISTS, and one
     * another agent was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedules, channels, conversations and the agents that hand work to it
     * name it by id; a parent agent's turns call it by its new slug.
     * </pre>
     */
    public void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an agent.
     * Deletion also removes the agent's version history and every channel in
     * the agent's own organization that serves it (its chat links and its
     * Slack and WhatsApp connections, whose installs are torn down first), so
     * a later agent created at the same org/slug starts clean. A teardown
     * that fails refuses the delete and keeps the agent and that channel, so
     * a retry finishes it. Sessions on the agent are not deleted: their next
     * message fails, naming the agent. Nor is a chat link written in another
     * organization before sharing across organizations was retired; such a
     * link stops resolving instead.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.agent.v1.AgentId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific agent version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * </pre>
     */
    public void tagVersion(ai.stigmer.agentic.agent.v1.TagAgentVersionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getTagVersionMethod(), getCallOptions()), request, responseObserver);
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
     * A request that carries metadata.id of an agent in its organization updates
     * that agent, and its slug changes only through rename. A slug the agent was
     * renamed away from, named without the agent's id, is refused with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second agent:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same agent
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent apply(ai.stigmer.agentic.agent.v1.Agent request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent.
     * A slug another agent of the organization holds is refused with
     * ALREADY_EXISTS. A slug another agent was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another agent held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent create(ai.stigmer.agentic.agent.v1.Agent request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the agent; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the agent does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the agent changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the agent kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent update(ai.stigmer.agentic.agent.v1.UpdateAgentInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * widen or narrow who can read the agent without sending the entire agent
     * resource (avoiding read-modify-write races).
     * Raising the level is refused while a skill, plugin or agent the
     * agent references is less visible than the requested level: what a
     * person can run they must also be able to read.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an agent: change its slug, the name people type.
     * The agent keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * agent for reading for 30 days, during which no other agent of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another agent holds is refused with ALREADY_EXISTS, and one
     * another agent was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedules, channels, conversations and the agents that hand work to it
     * name it by id; a parent agent's turns call it by its new slug.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent rename(ai.stigmer.commons.apiresource.RenameInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent.
     * Deletion also removes the agent's version history and every channel in
     * the agent's own organization that serves it (its chat links and its
     * Slack and WhatsApp connections, whose installs are torn down first), so
     * a later agent created at the same org/slug starts clean. A teardown
     * that fails refuses the delete and keeps the agent and that channel, so
     * a retry finishes it. Sessions on the agent are not deleted: their next
     * message fails, naming the agent. Nor is a chat link written in another
     * organization before sharing across organizations was retired; such a
     * link stops resolving instead.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent delete(ai.stigmer.agentic.agent.v1.AgentId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific agent version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent tagVersion(ai.stigmer.agentic.agent.v1.TagAgentVersionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getTagVersionMethod(), getCallOptions(), request);
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
     * A request that carries metadata.id of an agent in its organization updates
     * that agent, and its slug changes only through rename. A slug the agent was
     * renamed away from, named without the agent's id, is refused with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second agent:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same agent
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent apply(ai.stigmer.agentic.agent.v1.Agent request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an agent.
     * A slug another agent of the organization holds is refused with
     * ALREADY_EXISTS. A slug another agent was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another agent held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent create(ai.stigmer.agentic.agent.v1.Agent request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an agent: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the agent; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the agent does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the agent changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the agent kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent update(ai.stigmer.agentic.agent.v1.UpdateAgentInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * widen or narrow who can read the agent without sending the entire agent
     * resource (avoiding read-modify-write races).
     * Raising the level is refused while a skill, plugin or agent the
     * agent references is less visible than the requested level: what a
     * person can run they must also be able to read.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an agent: change its slug, the name people type.
     * The agent keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * agent for reading for 30 days, during which no other agent of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another agent holds is refused with ALREADY_EXISTS, and one
     * another agent was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedules, channels, conversations and the agents that hand work to it
     * name it by id; a parent agent's turns call it by its new slug.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent rename(ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an agent.
     * Deletion also removes the agent's version history and every channel in
     * the agent's own organization that serves it (its chat links and its
     * Slack and WhatsApp connections, whose installs are torn down first), so
     * a later agent created at the same org/slug starts clean. A teardown
     * that fails refuses the delete and keeps the agent and that channel, so
     * a retry finishes it. Sessions on the agent are not deleted: their next
     * message fails, naming the agent. Nor is a chat link written in another
     * organization before sharing across organizations was retired; such a
     * link stops resolving instead.
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent delete(ai.stigmer.agentic.agent.v1.AgentId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific agent version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * </pre>
     */
    public ai.stigmer.agentic.agent.v1.Agent tagVersion(ai.stigmer.agentic.agent.v1.TagAgentVersionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getTagVersionMethod(), getCallOptions(), request);
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
     * A request that carries metadata.id of an agent in its organization updates
     * that agent, and its slug changes only through rename. A slug the agent was
     * renamed away from, named without the agent's id, is refused with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second agent:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same agent
     *     for reading, but a write names its current slug. Metadata: slug (the
     *     one the request named).
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
     * A slug another agent of the organization holds is refused with
     * ALREADY_EXISTS. A slug another agent was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another agent held the slug until a recent rename, and
     *     it still leads there. Metadata: slug.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> create(
        ai.stigmer.agentic.agent.v1.Agent request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an agent: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the agent; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the agent does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the agent changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the agent kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> update(
        ai.stigmer.agentic.agent.v1.UpdateAgentInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing agent.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * widen or narrow who can read the agent without sending the entire agent
     * resource (avoiding read-modify-write races).
     * Raising the level is refused while a skill, plugin or agent the
     * agent references is less visible than the requested level: what a
     * person can run they must also be able to read.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rename an agent: change its slug, the name people type.
     * The agent keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * agent for reading for 30 days, during which no other agent of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another agent holds is refused with ALREADY_EXISTS, and one
     * another agent was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedules, channels, conversations and the agents that hand work to it
     * name it by id; a parent agent's turns call it by its new slug.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> rename(
        ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an agent.
     * Deletion also removes the agent's version history and every channel in
     * the agent's own organization that serves it (its chat links and its
     * Slack and WhatsApp connections, whose installs are torn down first), so
     * a later agent created at the same org/slug starts clean. A teardown
     * that fails refuses the delete and keeps the agent and that channel, so
     * a retry finishes it. Sessions on the agent are not deleted: their next
     * message fails, naming the agent. Nor is a chat link written in another
     * organization before sharing across organizations was retired; such a
     * link stops resolving instead.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> delete(
        ai.stigmer.agentic.agent.v1.AgentId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific agent version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agent.v1.Agent> tagVersion(
        ai.stigmer.agentic.agent.v1.TagAgentVersionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getTagVersionMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_RENAME = 4;
  private static final int METHODID_DELETE = 5;
  private static final int METHODID_TAG_VERSION = 6;

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
          serviceImpl.update((ai.stigmer.agentic.agent.v1.UpdateAgentInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_RENAME:
          serviceImpl.rename((ai.stigmer.commons.apiresource.RenameInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.agent.v1.AgentId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agent.v1.Agent>) responseObserver);
          break;
        case METHODID_TAG_VERSION:
          serviceImpl.tagVersion((ai.stigmer.agentic.agent.v1.TagAgentVersionInput) request,
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
              ai.stigmer.agentic.agent.v1.UpdateAgentInput,
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
          getRenameMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.RenameInput,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_RENAME)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agent.v1.AgentId,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_DELETE)))
        .addMethod(
          getTagVersionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agent.v1.TagAgentVersionInput,
              ai.stigmer.agentic.agent.v1.Agent>(
                service, METHODID_TAG_VERSION)))
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
              .addMethod(getRenameMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getTagVersionMethod())
              .build();
        }
      }
    }
    return result;
  }
}
