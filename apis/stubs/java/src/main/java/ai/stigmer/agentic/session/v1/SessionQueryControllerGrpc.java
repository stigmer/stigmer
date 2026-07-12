package ai.stigmer.agentic.session.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * SessionQueryController handles read operations for agent sessions.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class SessionQueryControllerGrpc {

  private SessionQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.session.v1.SessionQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.SessionId,
      ai.stigmer.agentic.session.v1.Session> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.session.v1.SessionId.class,
      responseType = ai.stigmer.agentic.session.v1.Session.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.SessionId,
      ai.stigmer.agentic.session.v1.Session> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.SessionId, ai.stigmer.agentic.session.v1.Session> getGetMethod;
    if ((getGetMethod = SessionQueryControllerGrpc.getGetMethod) == null) {
      synchronized (SessionQueryControllerGrpc.class) {
        if ((getGetMethod = SessionQueryControllerGrpc.getGetMethod) == null) {
          SessionQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.SessionId, ai.stigmer.agentic.session.v1.Session>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.SessionId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.Session.getDefaultInstance()))
              .setSchemaDescriptor(new SessionQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ListSessionsRequest,
      ai.stigmer.agentic.session.v1.SessionList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.session.v1.ListSessionsRequest.class,
      responseType = ai.stigmer.agentic.session.v1.SessionList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ListSessionsRequest,
      ai.stigmer.agentic.session.v1.SessionList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ListSessionsRequest, ai.stigmer.agentic.session.v1.SessionList> getListMethod;
    if ((getListMethod = SessionQueryControllerGrpc.getListMethod) == null) {
      synchronized (SessionQueryControllerGrpc.class) {
        if ((getListMethod = SessionQueryControllerGrpc.getListMethod) == null) {
          SessionQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.ListSessionsRequest, ai.stigmer.agentic.session.v1.SessionList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.ListSessionsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.SessionList.getDefaultInstance()))
              .setSchemaDescriptor(new SessionQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest,
      ai.stigmer.agentic.session.v1.SessionList> getListByAgentInstanceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listByAgentInstance",
      requestType = ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest.class,
      responseType = ai.stigmer.agentic.session.v1.SessionList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest,
      ai.stigmer.agentic.session.v1.SessionList> getListByAgentInstanceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest, ai.stigmer.agentic.session.v1.SessionList> getListByAgentInstanceMethod;
    if ((getListByAgentInstanceMethod = SessionQueryControllerGrpc.getListByAgentInstanceMethod) == null) {
      synchronized (SessionQueryControllerGrpc.class) {
        if ((getListByAgentInstanceMethod = SessionQueryControllerGrpc.getListByAgentInstanceMethod) == null) {
          SessionQueryControllerGrpc.getListByAgentInstanceMethod = getListByAgentInstanceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest, ai.stigmer.agentic.session.v1.SessionList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listByAgentInstance"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.SessionList.getDefaultInstance()))
              .setSchemaDescriptor(new SessionQueryControllerMethodDescriptorSupplier("listByAgentInstance"))
              .build();
        }
      }
    }
    return getListByAgentInstanceMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static SessionQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SessionQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SessionQueryControllerStub>() {
        @java.lang.Override
        public SessionQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SessionQueryControllerStub(channel, callOptions);
        }
      };
    return SessionQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static SessionQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SessionQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SessionQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public SessionQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SessionQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return SessionQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static SessionQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SessionQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SessionQueryControllerBlockingStub>() {
        @java.lang.Override
        public SessionQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SessionQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return SessionQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static SessionQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SessionQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SessionQueryControllerFutureStub>() {
        @java.lang.Override
        public SessionQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SessionQueryControllerFutureStub(channel, callOptions);
        }
      };
    return SessionQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * SessionQueryController handles read operations for agent sessions.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single session by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.session.v1.SessionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all sessions with pagination and optional filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    default void list(ai.stigmer.agentic.session.v1.ListSessionsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.SessionList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all sessions for a specific agent instance.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized
     * session_ids, then filtered by agent_instance_id.
     * </pre>
     */
    default void listByAgentInstance(ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.SessionList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListByAgentInstanceMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service SessionQueryController.
   * <pre>
   * SessionQueryController handles read operations for agent sessions.
   * </pre>
   */
  public static abstract class SessionQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return SessionQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service SessionQueryController.
   * <pre>
   * SessionQueryController handles read operations for agent sessions.
   * </pre>
   */
  public static final class SessionQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<SessionQueryControllerStub> {
    private SessionQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SessionQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SessionQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single session by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.session.v1.SessionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all sessions with pagination and optional filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    public void list(ai.stigmer.agentic.session.v1.ListSessionsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.SessionList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all sessions for a specific agent instance.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized
     * session_ids, then filtered by agent_instance_id.
     * </pre>
     */
    public void listByAgentInstance(ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.SessionList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListByAgentInstanceMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service SessionQueryController.
   * <pre>
   * SessionQueryController handles read operations for agent sessions.
   * </pre>
   */
  public static final class SessionQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<SessionQueryControllerBlockingV2Stub> {
    private SessionQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SessionQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SessionQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single session by ID.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session get(ai.stigmer.agentic.session.v1.SessionId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all sessions with pagination and optional filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.SessionList list(ai.stigmer.agentic.session.v1.ListSessionsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all sessions for a specific agent instance.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized
     * session_ids, then filtered by agent_instance_id.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.SessionList listByAgentInstance(ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListByAgentInstanceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service SessionQueryController.
   * <pre>
   * SessionQueryController handles read operations for agent sessions.
   * </pre>
   */
  public static final class SessionQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<SessionQueryControllerBlockingStub> {
    private SessionQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SessionQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SessionQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single session by ID.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session get(ai.stigmer.agentic.session.v1.SessionId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all sessions with pagination and optional filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.SessionList list(ai.stigmer.agentic.session.v1.ListSessionsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all sessions for a specific agent instance.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized
     * session_ids, then filtered by agent_instance_id.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.SessionList listByAgentInstance(ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListByAgentInstanceMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service SessionQueryController.
   * <pre>
   * SessionQueryController handles read operations for agent sessions.
   * </pre>
   */
  public static final class SessionQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<SessionQueryControllerFutureStub> {
    private SessionQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SessionQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SessionQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single session by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> get(
        ai.stigmer.agentic.session.v1.SessionId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all sessions with pagination and optional filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.SessionList> list(
        ai.stigmer.agentic.session.v1.ListSessionsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all sessions for a specific agent instance.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized
     * session_ids, then filtered by agent_instance_id.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.SessionList> listByAgentInstance(
        ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListByAgentInstanceMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST = 1;
  private static final int METHODID_LIST_BY_AGENT_INSTANCE = 2;

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
          serviceImpl.get((ai.stigmer.agentic.session.v1.SessionId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.session.v1.ListSessionsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.SessionList>) responseObserver);
          break;
        case METHODID_LIST_BY_AGENT_INSTANCE:
          serviceImpl.listByAgentInstance((ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.SessionList>) responseObserver);
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
              ai.stigmer.agentic.session.v1.SessionId,
              ai.stigmer.agentic.session.v1.Session>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.ListSessionsRequest,
              ai.stigmer.agentic.session.v1.SessionList>(
                service, METHODID_LIST)))
        .addMethod(
          getListByAgentInstanceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.ListSessionsByAgentInstanceRequest,
              ai.stigmer.agentic.session.v1.SessionList>(
                service, METHODID_LIST_BY_AGENT_INSTANCE)))
        .build();
  }

  private static abstract class SessionQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    SessionQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.session.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("SessionQueryController");
    }
  }

  private static final class SessionQueryControllerFileDescriptorSupplier
      extends SessionQueryControllerBaseDescriptorSupplier {
    SessionQueryControllerFileDescriptorSupplier() {}
  }

  private static final class SessionQueryControllerMethodDescriptorSupplier
      extends SessionQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    SessionQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (SessionQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new SessionQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .addMethod(getListByAgentInstanceMethod())
              .build();
        }
      }
    }
    return result;
  }
}
