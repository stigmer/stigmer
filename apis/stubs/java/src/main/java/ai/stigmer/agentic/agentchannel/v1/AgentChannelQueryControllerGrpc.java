package ai.stigmer.agentic.agentchannel.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentChannelQueryController handles read operations for agent channels.
 * &#64;internal
 * Deliberately no anonymous/public RPC (AgentShare's getSharedProfile has
 * no analog here): the channel's public surface is the provider webhook,
 * which authenticates by signature — never a query endpoint.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentChannelQueryControllerGrpc {

  private AgentChannelQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentchannel.v1.AgentChannelQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannelId,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.agentchannel.v1.AgentChannelId.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannelId,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.AgentChannelId, ai.stigmer.agentic.agentchannel.v1.AgentChannel> getGetMethod;
    if ((getGetMethod = AgentChannelQueryControllerGrpc.getGetMethod) == null) {
      synchronized (AgentChannelQueryControllerGrpc.class) {
        if ((getGetMethod = AgentChannelQueryControllerGrpc.getGetMethod) == null) {
          AgentChannelQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.AgentChannelId, ai.stigmer.agentic.agentchannel.v1.AgentChannel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannelId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.AgentChannel.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.agentchannel.v1.AgentChannel> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentchannel.v1.AgentChannel> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = AgentChannelQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (AgentChannelQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = AgentChannelQueryControllerGrpc.getGetByReferenceMethod) == null) {
          AgentChannelQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.agentchannel.v1.AgentChannel>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannel.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest,
      ai.stigmer.agentic.agentchannel.v1.AgentChannelList> getGetByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByAgent",
      requestType = ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.AgentChannelList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest,
      ai.stigmer.agentic.agentchannel.v1.AgentChannelList> getGetByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest, ai.stigmer.agentic.agentchannel.v1.AgentChannelList> getGetByAgentMethod;
    if ((getGetByAgentMethod = AgentChannelQueryControllerGrpc.getGetByAgentMethod) == null) {
      synchronized (AgentChannelQueryControllerGrpc.class) {
        if ((getGetByAgentMethod = AgentChannelQueryControllerGrpc.getGetByAgentMethod) == null) {
          AgentChannelQueryControllerGrpc.getGetByAgentMethod = getGetByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest, ai.stigmer.agentic.agentchannel.v1.AgentChannelList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannelList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelQueryControllerMethodDescriptorSupplier("getByAgent"))
              .build();
        }
      }
    }
    return getGetByAgentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest,
      ai.stigmer.agentic.agentchannel.v1.AgentChannelList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.AgentChannelList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest,
      ai.stigmer.agentic.agentchannel.v1.AgentChannelList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest, ai.stigmer.agentic.agentchannel.v1.AgentChannelList> getListMethod;
    if ((getListMethod = AgentChannelQueryControllerGrpc.getListMethod) == null) {
      synchronized (AgentChannelQueryControllerGrpc.class) {
        if ((getListMethod = AgentChannelQueryControllerGrpc.getListMethod) == null) {
          AgentChannelQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest, ai.stigmer.agentic.agentchannel.v1.AgentChannelList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.AgentChannelList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentChannelQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentChannelQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentChannelQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentChannelQueryControllerStub>() {
        @java.lang.Override
        public AgentChannelQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentChannelQueryControllerStub(channel, callOptions);
        }
      };
    return AgentChannelQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentChannelQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentChannelQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentChannelQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentChannelQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentChannelQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentChannelQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentChannelQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentChannelQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentChannelQueryControllerBlockingStub>() {
        @java.lang.Override
        public AgentChannelQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentChannelQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentChannelQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentChannelQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentChannelQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentChannelQueryControllerFutureStub>() {
        @java.lang.Override
        public AgentChannelQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentChannelQueryControllerFutureStub(channel, callOptions);
        }
      };
    return AgentChannelQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentChannelQueryController handles read operations for agent channels.
   * &#64;internal
   * Deliberately no anonymous/public RPC (AgentShare's getSharedProfile has
   * no analog here): the channel's public surface is the provider webhook,
   * which authenticates by signature — never a query endpoint.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single agent channel by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.agentchannel.v1.AgentChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get an agent channel by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (AgentShare pattern).
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get all channels of a specific agent.
     * Returns only channels the caller has access to.
     * This is how the agent's integrations surface and CLI resolve an
     * agent's existing channels regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS.
     * </pre>
     */
    default void getByAgent(ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannelList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByAgentMethod(), responseObserver);
    }

    /**
     * <pre>
     * List agent channels with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    default void list(ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannelList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentChannelQueryController.
   * <pre>
   * AgentChannelQueryController handles read operations for agent channels.
   * &#64;internal
   * Deliberately no anonymous/public RPC (AgentShare's getSharedProfile has
   * no analog here): the channel's public surface is the provider webhook,
   * which authenticates by signature — never a query endpoint.
   * </pre>
   */
  public static abstract class AgentChannelQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentChannelQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentChannelQueryController.
   * <pre>
   * AgentChannelQueryController handles read operations for agent channels.
   * &#64;internal
   * Deliberately no anonymous/public RPC (AgentShare's getSharedProfile has
   * no analog here): the channel's public surface is the provider webhook,
   * which authenticates by signature — never a query endpoint.
   * </pre>
   */
  public static final class AgentChannelQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentChannelQueryControllerStub> {
    private AgentChannelQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentChannelQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentChannelQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent channel by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.agentchannel.v1.AgentChannelId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get an agent channel by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (AgentShare pattern).
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get all channels of a specific agent.
     * Returns only channels the caller has access to.
     * This is how the agent's integrations surface and CLI resolve an
     * agent's existing channels regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS.
     * </pre>
     */
    public void getByAgent(ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannelList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List agent channels with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    public void list(ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannelList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentChannelQueryController.
   * <pre>
   * AgentChannelQueryController handles read operations for agent channels.
   * &#64;internal
   * Deliberately no anonymous/public RPC (AgentShare's getSharedProfile has
   * no analog here): the channel's public surface is the provider webhook,
   * which authenticates by signature — never a query endpoint.
   * </pre>
   */
  public static final class AgentChannelQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentChannelQueryControllerBlockingV2Stub> {
    private AgentChannelQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentChannelQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentChannelQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent channel by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel get(ai.stigmer.agentic.agentchannel.v1.AgentChannelId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent channel by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (AgentShare pattern).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all channels of a specific agent.
     * Returns only channels the caller has access to.
     * This is how the agent's integrations surface and CLI resolve an
     * agent's existing channels regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannelList getByAgent(ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List agent channels with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannelList list(ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentChannelQueryController.
   * <pre>
   * AgentChannelQueryController handles read operations for agent channels.
   * &#64;internal
   * Deliberately no anonymous/public RPC (AgentShare's getSharedProfile has
   * no analog here): the channel's public surface is the provider webhook,
   * which authenticates by signature — never a query endpoint.
   * </pre>
   */
  public static final class AgentChannelQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentChannelQueryControllerBlockingStub> {
    private AgentChannelQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentChannelQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentChannelQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent channel by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel get(ai.stigmer.agentic.agentchannel.v1.AgentChannelId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get an agent channel by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (AgentShare pattern).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannel getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all channels of a specific agent.
     * Returns only channels the caller has access to.
     * This is how the agent's integrations surface and CLI resolve an
     * agent's existing channels regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannelList getByAgent(ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List agent channels with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.AgentChannelList list(ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentChannelQueryController.
   * <pre>
   * AgentChannelQueryController handles read operations for agent channels.
   * &#64;internal
   * Deliberately no anonymous/public RPC (AgentShare's getSharedProfile has
   * no analog here): the channel's public surface is the provider webhook,
   * which authenticates by signature — never a query endpoint.
   * </pre>
   */
  public static final class AgentChannelQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentChannelQueryControllerFutureStub> {
    private AgentChannelQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentChannelQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentChannelQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent channel by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.AgentChannel> get(
        ai.stigmer.agentic.agentchannel.v1.AgentChannelId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get an agent channel by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (AgentShare pattern).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.AgentChannel> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get all channels of a specific agent.
     * Returns only channels the caller has access to.
     * This is how the agent's integrations surface and CLI resolve an
     * agent's existing channels regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.AgentChannelList> getByAgent(
        ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List agent channels with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.AgentChannelList> list(
        ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_GET_BY_AGENT = 2;
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
          serviceImpl.get((ai.stigmer.agentic.agentchannel.v1.AgentChannelId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannel>) responseObserver);
          break;
        case METHODID_GET_BY_AGENT:
          serviceImpl.getByAgent((ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannelList>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.AgentChannelList>) responseObserver);
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
              ai.stigmer.agentic.agentchannel.v1.AgentChannelId,
              ai.stigmer.agentic.agentchannel.v1.AgentChannel>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.agentchannel.v1.AgentChannel>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getGetByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.GetAgentChannelsByAgentRequest,
              ai.stigmer.agentic.agentchannel.v1.AgentChannelList>(
                service, METHODID_GET_BY_AGENT)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.ListAgentChannelsRequest,
              ai.stigmer.agentic.agentchannel.v1.AgentChannelList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class AgentChannelQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentChannelQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentchannel.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentChannelQueryController");
    }
  }

  private static final class AgentChannelQueryControllerFileDescriptorSupplier
      extends AgentChannelQueryControllerBaseDescriptorSupplier {
    AgentChannelQueryControllerFileDescriptorSupplier() {}
  }

  private static final class AgentChannelQueryControllerMethodDescriptorSupplier
      extends AgentChannelQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentChannelQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentChannelQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentChannelQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getGetByAgentMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
