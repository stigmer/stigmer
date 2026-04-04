package ai.stigmer.agentic.agentinstance.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentInstanceQueryController handles read operations for agent instances.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentInstanceQueryControllerGrpc {

  private AgentInstanceQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentinstance.v1.AgentInstanceQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstanceId,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.agentinstance.v1.AgentInstanceId.class,
      responseType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstanceId,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.AgentInstanceId, ai.stigmer.agentic.agentinstance.v1.AgentInstance> getGetMethod;
    if ((getGetMethod = AgentInstanceQueryControllerGrpc.getGetMethod) == null) {
      synchronized (AgentInstanceQueryControllerGrpc.class) {
        if ((getGetMethod = AgentInstanceQueryControllerGrpc.getGetMethod) == null) {
          AgentInstanceQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentinstance.v1.AgentInstanceId, ai.stigmer.agentic.agentinstance.v1.AgentInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstanceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setSchemaDescriptor(new AgentInstanceQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest,
      ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> getGetByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByAgent",
      requestType = ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest.class,
      responseType = ai.stigmer.agentic.agentinstance.v1.AgentInstanceList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest,
      ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> getGetByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest, ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> getGetByAgentMethod;
    if ((getGetByAgentMethod = AgentInstanceQueryControllerGrpc.getGetByAgentMethod) == null) {
      synchronized (AgentInstanceQueryControllerGrpc.class) {
        if ((getGetByAgentMethod = AgentInstanceQueryControllerGrpc.getGetByAgentMethod) == null) {
          AgentInstanceQueryControllerGrpc.getGetByAgentMethod = getGetByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest, ai.stigmer.agentic.agentinstance.v1.AgentInstanceList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstanceList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentInstanceQueryControllerMethodDescriptorSupplier("getByAgent"))
              .build();
        }
      }
    }
    return getGetByAgentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.agentinstance.v1.AgentInstance.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentinstance.v1.AgentInstance> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentinstance.v1.AgentInstance> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = AgentInstanceQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (AgentInstanceQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = AgentInstanceQueryControllerGrpc.getGetByReferenceMethod) == null) {
          AgentInstanceQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentinstance.v1.AgentInstance>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstance.getDefaultInstance()))
              .setSchemaDescriptor(new AgentInstanceQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest,
      ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest.class,
      responseType = ai.stigmer.agentic.agentinstance.v1.AgentInstanceList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest,
      ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest, ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> getListMethod;
    if ((getListMethod = AgentInstanceQueryControllerGrpc.getListMethod) == null) {
      synchronized (AgentInstanceQueryControllerGrpc.class) {
        if ((getListMethod = AgentInstanceQueryControllerGrpc.getListMethod) == null) {
          AgentInstanceQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest, ai.stigmer.agentic.agentinstance.v1.AgentInstanceList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentinstance.v1.AgentInstanceList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentInstanceQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentInstanceQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentInstanceQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentInstanceQueryControllerStub>() {
        @java.lang.Override
        public AgentInstanceQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentInstanceQueryControllerStub(channel, callOptions);
        }
      };
    return AgentInstanceQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentInstanceQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentInstanceQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentInstanceQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentInstanceQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentInstanceQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentInstanceQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentInstanceQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentInstanceQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentInstanceQueryControllerBlockingStub>() {
        @java.lang.Override
        public AgentInstanceQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentInstanceQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentInstanceQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentInstanceQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentInstanceQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentInstanceQueryControllerFutureStub>() {
        @java.lang.Override
        public AgentInstanceQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentInstanceQueryControllerFutureStub(channel, callOptions);
        }
      };
    return AgentInstanceQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentInstanceQueryController handles read operations for agent instances.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single agent instance by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get all instances of a specific agent template.
     * Returns only instances the caller has access to.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_instance_ids,
     * then filtered by agent_id.
     * </pre>
     */
    default void getByAgent(ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByAgentMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an agent instance by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List agent instances with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    default void list(ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentInstanceQueryController.
   * <pre>
   * AgentInstanceQueryController handles read operations for agent instances.
   * </pre>
   */
  public static abstract class AgentInstanceQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentInstanceQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentInstanceQueryController.
   * <pre>
   * AgentInstanceQueryController handles read operations for agent instances.
   * </pre>
   */
  public static final class AgentInstanceQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentInstanceQueryControllerStub> {
    private AgentInstanceQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentInstanceQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentInstanceQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent instance by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get all instances of a specific agent template.
     * Returns only instances the caller has access to.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_instance_ids,
     * then filtered by agent_id.
     * </pre>
     */
    public void getByAgent(ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an agent instance by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List agent instances with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public void list(ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentInstanceQueryController.
   * <pre>
   * AgentInstanceQueryController handles read operations for agent instances.
   * </pre>
   */
  public static final class AgentInstanceQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentInstanceQueryControllerBlockingV2Stub> {
    private AgentInstanceQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentInstanceQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentInstanceQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent instance by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance get(ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all instances of a specific agent template.
     * Returns only instances the caller has access to.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_instance_ids,
     * then filtered by agent_id.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstanceList getByAgent(ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent instance by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List agent instances with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstanceList list(ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentInstanceQueryController.
   * <pre>
   * AgentInstanceQueryController handles read operations for agent instances.
   * </pre>
   */
  public static final class AgentInstanceQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentInstanceQueryControllerBlockingStub> {
    private AgentInstanceQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentInstanceQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentInstanceQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent instance by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance get(ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all instances of a specific agent template.
     * Returns only instances the caller has access to.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_instance_ids,
     * then filtered by agent_id.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstanceList getByAgent(ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent instance by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler.
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstance getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List agent instances with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.agentinstance.v1.AgentInstanceList list(ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentInstanceQueryController.
   * <pre>
   * AgentInstanceQueryController handles read operations for agent instances.
   * </pre>
   */
  public static final class AgentInstanceQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentInstanceQueryControllerFutureStub> {
    private AgentInstanceQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentInstanceQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentInstanceQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent instance by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentinstance.v1.AgentInstance> get(
        ai.stigmer.agentic.agentinstance.v1.AgentInstanceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get all instances of a specific agent template.
     * Returns only instances the caller has access to.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_instance_ids,
     * then filtered by agent_id.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> getByAgent(
        ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an agent instance by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentinstance.v1.AgentInstance> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List agent instances with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentinstance.v1.AgentInstanceList> list(
        ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_AGENT = 1;
  private static final int METHODID_GET_BY_REFERENCE = 2;
  private static final int METHODID_LIST = 3;

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
          serviceImpl.get((ai.stigmer.agentic.agentinstance.v1.AgentInstanceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance>) responseObserver);
          break;
        case METHODID_GET_BY_AGENT:
          serviceImpl.getByAgent((ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstanceList>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstance>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentinstance.v1.AgentInstanceList>) responseObserver);
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
              ai.stigmer.agentic.agentinstance.v1.AgentInstanceId,
              ai.stigmer.agentic.agentinstance.v1.AgentInstance>(
                service, METHODID_GET)))
        .addMethod(
          getGetByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentinstance.v1.GetAgentInstancesByAgentRequest,
              ai.stigmer.agentic.agentinstance.v1.AgentInstanceList>(
                service, METHODID_GET_BY_AGENT)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.agentinstance.v1.AgentInstance>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentinstance.v1.ListAgentInstancesRequest,
              ai.stigmer.agentic.agentinstance.v1.AgentInstanceList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class AgentInstanceQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentInstanceQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentinstance.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentInstanceQueryController");
    }
  }

  private static final class AgentInstanceQueryControllerFileDescriptorSupplier
      extends AgentInstanceQueryControllerBaseDescriptorSupplier {
    AgentInstanceQueryControllerFileDescriptorSupplier() {}
  }

  private static final class AgentInstanceQueryControllerMethodDescriptorSupplier
      extends AgentInstanceQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentInstanceQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentInstanceQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentInstanceQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByAgentMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
