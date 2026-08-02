package ai.stigmer.agentic.schedule.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ScheduleQueryController handles read operations for schedules.
 * &#64;internal
 * No anonymous/public RPC by design (the AgentChannel posture): a
 * schedule has no public surface at all — its only runtime effect is the
 * executions its fires create.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ScheduleQueryControllerGrpc {

  private ScheduleQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.schedule.v1.ScheduleQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.ScheduleId,
      ai.stigmer.agentic.schedule.v1.Schedule> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.schedule.v1.ScheduleId.class,
      responseType = ai.stigmer.agentic.schedule.v1.Schedule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.ScheduleId,
      ai.stigmer.agentic.schedule.v1.Schedule> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.ScheduleId, ai.stigmer.agentic.schedule.v1.Schedule> getGetMethod;
    if ((getGetMethod = ScheduleQueryControllerGrpc.getGetMethod) == null) {
      synchronized (ScheduleQueryControllerGrpc.class) {
        if ((getGetMethod = ScheduleQueryControllerGrpc.getGetMethod) == null) {
          ScheduleQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.schedule.v1.ScheduleId, ai.stigmer.agentic.schedule.v1.Schedule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.ScheduleId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.Schedule.getDefaultInstance()))
              .setSchemaDescriptor(new ScheduleQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.schedule.v1.Schedule> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.schedule.v1.Schedule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.schedule.v1.Schedule> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.schedule.v1.Schedule> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = ScheduleQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (ScheduleQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = ScheduleQueryControllerGrpc.getGetByReferenceMethod) == null) {
          ScheduleQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.schedule.v1.Schedule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.Schedule.getDefaultInstance()))
              .setSchemaDescriptor(new ScheduleQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest,
      ai.stigmer.agentic.schedule.v1.ScheduleList> getGetByAgentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByAgent",
      requestType = ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest.class,
      responseType = ai.stigmer.agentic.schedule.v1.ScheduleList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest,
      ai.stigmer.agentic.schedule.v1.ScheduleList> getGetByAgentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest, ai.stigmer.agentic.schedule.v1.ScheduleList> getGetByAgentMethod;
    if ((getGetByAgentMethod = ScheduleQueryControllerGrpc.getGetByAgentMethod) == null) {
      synchronized (ScheduleQueryControllerGrpc.class) {
        if ((getGetByAgentMethod = ScheduleQueryControllerGrpc.getGetByAgentMethod) == null) {
          ScheduleQueryControllerGrpc.getGetByAgentMethod = getGetByAgentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest, ai.stigmer.agentic.schedule.v1.ScheduleList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByAgent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.ScheduleList.getDefaultInstance()))
              .setSchemaDescriptor(new ScheduleQueryControllerMethodDescriptorSupplier("getByAgent"))
              .build();
        }
      }
    }
    return getGetByAgentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.ListSchedulesRequest,
      ai.stigmer.agentic.schedule.v1.ScheduleList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.schedule.v1.ListSchedulesRequest.class,
      responseType = ai.stigmer.agentic.schedule.v1.ScheduleList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.ListSchedulesRequest,
      ai.stigmer.agentic.schedule.v1.ScheduleList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.ListSchedulesRequest, ai.stigmer.agentic.schedule.v1.ScheduleList> getListMethod;
    if ((getListMethod = ScheduleQueryControllerGrpc.getListMethod) == null) {
      synchronized (ScheduleQueryControllerGrpc.class) {
        if ((getListMethod = ScheduleQueryControllerGrpc.getListMethod) == null) {
          ScheduleQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.schedule.v1.ListSchedulesRequest, ai.stigmer.agentic.schedule.v1.ScheduleList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.ListSchedulesRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.ScheduleList.getDefaultInstance()))
              .setSchemaDescriptor(new ScheduleQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ScheduleQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScheduleQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScheduleQueryControllerStub>() {
        @java.lang.Override
        public ScheduleQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScheduleQueryControllerStub(channel, callOptions);
        }
      };
    return ScheduleQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ScheduleQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScheduleQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScheduleQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ScheduleQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScheduleQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ScheduleQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ScheduleQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScheduleQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScheduleQueryControllerBlockingStub>() {
        @java.lang.Override
        public ScheduleQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScheduleQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ScheduleQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ScheduleQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScheduleQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScheduleQueryControllerFutureStub>() {
        @java.lang.Override
        public ScheduleQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScheduleQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ScheduleQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ScheduleQueryController handles read operations for schedules.
   * &#64;internal
   * No anonymous/public RPC by design (the AgentChannel posture): a
   * schedule has no public surface at all — its only runtime effect is the
   * executions its fires create.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single schedule by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.schedule.v1.ScheduleId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a schedule by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the AgentShare /
     * AgentChannel pattern).
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get all schedules of a specific agent.
     * Returns only schedules the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing schedules regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS
     * (the getByAgent family convention — agent channels, agent shares,
     * agent instances).
     * </pre>
     */
    default void getByAgent(ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.ScheduleList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByAgentMethod(), responseObserver);
    }

    /**
     * <pre>
     * List schedules with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    default void list(ai.stigmer.agentic.schedule.v1.ListSchedulesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.ScheduleList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ScheduleQueryController.
   * <pre>
   * ScheduleQueryController handles read operations for schedules.
   * &#64;internal
   * No anonymous/public RPC by design (the AgentChannel posture): a
   * schedule has no public surface at all — its only runtime effect is the
   * executions its fires create.
   * </pre>
   */
  public static abstract class ScheduleQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ScheduleQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ScheduleQueryController.
   * <pre>
   * ScheduleQueryController handles read operations for schedules.
   * &#64;internal
   * No anonymous/public RPC by design (the AgentChannel posture): a
   * schedule has no public surface at all — its only runtime effect is the
   * executions its fires create.
   * </pre>
   */
  public static final class ScheduleQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ScheduleQueryControllerStub> {
    private ScheduleQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScheduleQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScheduleQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single schedule by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.schedule.v1.ScheduleId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a schedule by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the AgentShare /
     * AgentChannel pattern).
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get all schedules of a specific agent.
     * Returns only schedules the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing schedules regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS
     * (the getByAgent family convention — agent channels, agent shares,
     * agent instances).
     * </pre>
     */
    public void getByAgent(ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.ScheduleList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List schedules with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    public void list(ai.stigmer.agentic.schedule.v1.ListSchedulesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.ScheduleList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ScheduleQueryController.
   * <pre>
   * ScheduleQueryController handles read operations for schedules.
   * &#64;internal
   * No anonymous/public RPC by design (the AgentChannel posture): a
   * schedule has no public surface at all — its only runtime effect is the
   * executions its fires create.
   * </pre>
   */
  public static final class ScheduleQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ScheduleQueryControllerBlockingV2Stub> {
    private ScheduleQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScheduleQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScheduleQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single schedule by ID.
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule get(ai.stigmer.agentic.schedule.v1.ScheduleId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a schedule by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the AgentShare /
     * AgentChannel pattern).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all schedules of a specific agent.
     * Returns only schedules the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing schedules regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS
     * (the getByAgent family convention — agent channels, agent shares,
     * agent instances).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.ScheduleList getByAgent(ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List schedules with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.ScheduleList list(ai.stigmer.agentic.schedule.v1.ListSchedulesRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ScheduleQueryController.
   * <pre>
   * ScheduleQueryController handles read operations for schedules.
   * &#64;internal
   * No anonymous/public RPC by design (the AgentChannel posture): a
   * schedule has no public surface at all — its only runtime effect is the
   * executions its fires create.
   * </pre>
   */
  public static final class ScheduleQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ScheduleQueryControllerBlockingStub> {
    private ScheduleQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScheduleQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScheduleQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single schedule by ID.
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule get(ai.stigmer.agentic.schedule.v1.ScheduleId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a schedule by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the AgentShare /
     * AgentChannel pattern).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all schedules of a specific agent.
     * Returns only schedules the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing schedules regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS
     * (the getByAgent family convention — agent channels, agent shares,
     * agent instances).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.ScheduleList getByAgent(ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByAgentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List schedules with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.ScheduleList list(ai.stigmer.agentic.schedule.v1.ListSchedulesRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ScheduleQueryController.
   * <pre>
   * ScheduleQueryController handles read operations for schedules.
   * &#64;internal
   * No anonymous/public RPC by design (the AgentChannel posture): a
   * schedule has no public surface at all — its only runtime effect is the
   * executions its fires create.
   * </pre>
   */
  public static final class ScheduleQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ScheduleQueryControllerFutureStub> {
    private ScheduleQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScheduleQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScheduleQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single schedule by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.schedule.v1.Schedule> get(
        ai.stigmer.agentic.schedule.v1.ScheduleId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a schedule by its organization-scoped reference (org/slug).
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions (the AgentShare /
     * AgentChannel pattern).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.schedule.v1.Schedule> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get all schedules of a specific agent.
     * Returns only schedules the caller has access to.
     * This is how the agent's operational surfaces and CLI resolve an
     * agent's existing schedules regardless of slug.
     * &#64;internal
     * Authorization in-handler: FGA-filtered in cloud, unrestricted in OSS
     * (the getByAgent family convention — agent channels, agent shares,
     * agent instances).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.schedule.v1.ScheduleList> getByAgent(
        ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByAgentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List schedules with optional label filtering.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud) or
     * unrestricted store queries (OSS).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.schedule.v1.ScheduleList> list(
        ai.stigmer.agentic.schedule.v1.ListSchedulesRequest request) {
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
          serviceImpl.get((ai.stigmer.agentic.schedule.v1.ScheduleId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule>) responseObserver);
          break;
        case METHODID_GET_BY_AGENT:
          serviceImpl.getByAgent((ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.ScheduleList>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.schedule.v1.ListSchedulesRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.ScheduleList>) responseObserver);
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
              ai.stigmer.agentic.schedule.v1.ScheduleId,
              ai.stigmer.agentic.schedule.v1.Schedule>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.schedule.v1.Schedule>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getGetByAgentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.schedule.v1.GetSchedulesByAgentRequest,
              ai.stigmer.agentic.schedule.v1.ScheduleList>(
                service, METHODID_GET_BY_AGENT)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.schedule.v1.ListSchedulesRequest,
              ai.stigmer.agentic.schedule.v1.ScheduleList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class ScheduleQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ScheduleQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.schedule.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ScheduleQueryController");
    }
  }

  private static final class ScheduleQueryControllerFileDescriptorSupplier
      extends ScheduleQueryControllerBaseDescriptorSupplier {
    ScheduleQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ScheduleQueryControllerMethodDescriptorSupplier
      extends ScheduleQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ScheduleQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ScheduleQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ScheduleQueryControllerFileDescriptorSupplier())
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
