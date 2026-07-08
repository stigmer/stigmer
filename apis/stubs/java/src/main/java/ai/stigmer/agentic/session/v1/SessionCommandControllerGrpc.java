package ai.stigmer.agentic.session.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * SessionCommandController handles write operations for agent sessions.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class SessionCommandControllerGrpc {

  private SessionCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.session.v1.SessionCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.Session,
      ai.stigmer.agentic.session.v1.Session> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.session.v1.Session.class,
      responseType = ai.stigmer.agentic.session.v1.Session.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.Session,
      ai.stigmer.agentic.session.v1.Session> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.Session, ai.stigmer.agentic.session.v1.Session> getApplyMethod;
    if ((getApplyMethod = SessionCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getApplyMethod = SessionCommandControllerGrpc.getApplyMethod) == null) {
          SessionCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.Session, ai.stigmer.agentic.session.v1.Session>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.Session.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.Session.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.Session,
      ai.stigmer.agentic.session.v1.Session> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.session.v1.Session.class,
      responseType = ai.stigmer.agentic.session.v1.Session.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.Session,
      ai.stigmer.agentic.session.v1.Session> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.Session, ai.stigmer.agentic.session.v1.Session> getCreateMethod;
    if ((getCreateMethod = SessionCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getCreateMethod = SessionCommandControllerGrpc.getCreateMethod) == null) {
          SessionCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.Session, ai.stigmer.agentic.session.v1.Session>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.Session.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.Session.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.Session,
      ai.stigmer.agentic.session.v1.Session> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.session.v1.Session.class,
      responseType = ai.stigmer.agentic.session.v1.Session.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.Session,
      ai.stigmer.agentic.session.v1.Session> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.Session, ai.stigmer.agentic.session.v1.Session> getUpdateMethod;
    if ((getUpdateMethod = SessionCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getUpdateMethod = SessionCommandControllerGrpc.getUpdateMethod) == null) {
          SessionCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.Session, ai.stigmer.agentic.session.v1.Session>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.Session.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.Session.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest,
      ai.stigmer.agentic.session.v1.Session> getUpdateSubjectMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateSubject",
      requestType = ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest.class,
      responseType = ai.stigmer.agentic.session.v1.Session.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest,
      ai.stigmer.agentic.session.v1.Session> getUpdateSubjectMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest, ai.stigmer.agentic.session.v1.Session> getUpdateSubjectMethod;
    if ((getUpdateSubjectMethod = SessionCommandControllerGrpc.getUpdateSubjectMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getUpdateSubjectMethod = SessionCommandControllerGrpc.getUpdateSubjectMethod) == null) {
          SessionCommandControllerGrpc.getUpdateSubjectMethod = getUpdateSubjectMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest, ai.stigmer.agentic.session.v1.Session>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateSubject"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.Session.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("updateSubject"))
              .build();
        }
      }
    }
    return getUpdateSubjectMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.SessionId,
      ai.stigmer.agentic.session.v1.Session> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.session.v1.SessionId.class,
      responseType = ai.stigmer.agentic.session.v1.Session.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.SessionId,
      ai.stigmer.agentic.session.v1.Session> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.SessionId, ai.stigmer.agentic.session.v1.Session> getDeleteMethod;
    if ((getDeleteMethod = SessionCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getDeleteMethod = SessionCommandControllerGrpc.getDeleteMethod) == null) {
          SessionCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.SessionId, ai.stigmer.agentic.session.v1.Session>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.SessionId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.Session.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static SessionCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SessionCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SessionCommandControllerStub>() {
        @java.lang.Override
        public SessionCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SessionCommandControllerStub(channel, callOptions);
        }
      };
    return SessionCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static SessionCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SessionCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SessionCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public SessionCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SessionCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return SessionCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static SessionCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SessionCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SessionCommandControllerBlockingStub>() {
        @java.lang.Override
        public SessionCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SessionCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return SessionCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static SessionCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<SessionCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<SessionCommandControllerFutureStub>() {
        @java.lang.Override
        public SessionCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new SessionCommandControllerFutureStub(channel, callOptions);
        }
      };
    return SessionCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * SessionCommandController handles write operations for agent sessions.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a session.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the session
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.session.v1.Session request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a session.
     * &#64;internal
     * Requires can_create_session permission in the organization.
     * </pre>
     */
    default void create(ai.stigmer.agentic.session.v1.Session request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing session (e.g., subject, thread_id).
     * </pre>
     */
    default void update(ai.stigmer.agentic.session.v1.Session request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Set the session subject.
     * This is a targeted update that modifies only the subject field,
     * leaving other session fields untouched. Use this instead of the full
     * update RPC when you only need to change the session subject.
     * &#64;internal
     * Server-side field-level update, race-safe. Atomically modifies only
     * spec.subject without touching other fields.
     * </pre>
     */
    default void updateSubject(ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateSubjectMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's agent executions. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and execution identifiers.
     * Fails with FAILED_PRECONDITION while any agent execution in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * &#64;internal
     * Requires can_delete on the session (owner-only — sessions are personal
     * resources, so org admins have no implicit delete access).
     * </pre>
     */
    default void delete(ai.stigmer.agentic.session.v1.SessionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service SessionCommandController.
   * <pre>
   * SessionCommandController handles write operations for agent sessions.
   * </pre>
   */
  public static abstract class SessionCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return SessionCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service SessionCommandController.
   * <pre>
   * SessionCommandController handles write operations for agent sessions.
   * </pre>
   */
  public static final class SessionCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<SessionCommandControllerStub> {
    private SessionCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SessionCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SessionCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a session.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the session
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.session.v1.Session request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a session.
     * &#64;internal
     * Requires can_create_session permission in the organization.
     * </pre>
     */
    public void create(ai.stigmer.agentic.session.v1.Session request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing session (e.g., subject, thread_id).
     * </pre>
     */
    public void update(ai.stigmer.agentic.session.v1.Session request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Set the session subject.
     * This is a targeted update that modifies only the subject field,
     * leaving other session fields untouched. Use this instead of the full
     * update RPC when you only need to change the session subject.
     * &#64;internal
     * Server-side field-level update, race-safe. Atomically modifies only
     * spec.subject without touching other fields.
     * </pre>
     */
    public void updateSubject(ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateSubjectMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's agent executions. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and execution identifiers.
     * Fails with FAILED_PRECONDITION while any agent execution in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * &#64;internal
     * Requires can_delete on the session (owner-only — sessions are personal
     * resources, so org admins have no implicit delete access).
     * </pre>
     */
    public void delete(ai.stigmer.agentic.session.v1.SessionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service SessionCommandController.
   * <pre>
   * SessionCommandController handles write operations for agent sessions.
   * </pre>
   */
  public static final class SessionCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<SessionCommandControllerBlockingV2Stub> {
    private SessionCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SessionCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SessionCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a session.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the session
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session apply(ai.stigmer.agentic.session.v1.Session request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a session.
     * &#64;internal
     * Requires can_create_session permission in the organization.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session create(ai.stigmer.agentic.session.v1.Session request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing session (e.g., subject, thread_id).
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session update(ai.stigmer.agentic.session.v1.Session request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Set the session subject.
     * This is a targeted update that modifies only the subject field,
     * leaving other session fields untouched. Use this instead of the full
     * update RPC when you only need to change the session subject.
     * &#64;internal
     * Server-side field-level update, race-safe. Atomically modifies only
     * spec.subject without touching other fields.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session updateSubject(ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateSubjectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's agent executions. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and execution identifiers.
     * Fails with FAILED_PRECONDITION while any agent execution in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * &#64;internal
     * Requires can_delete on the session (owner-only — sessions are personal
     * resources, so org admins have no implicit delete access).
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session delete(ai.stigmer.agentic.session.v1.SessionId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service SessionCommandController.
   * <pre>
   * SessionCommandController handles write operations for agent sessions.
   * </pre>
   */
  public static final class SessionCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<SessionCommandControllerBlockingStub> {
    private SessionCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SessionCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SessionCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a session.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the session
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session apply(ai.stigmer.agentic.session.v1.Session request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a session.
     * &#64;internal
     * Requires can_create_session permission in the organization.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session create(ai.stigmer.agentic.session.v1.Session request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing session (e.g., subject, thread_id).
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session update(ai.stigmer.agentic.session.v1.Session request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Set the session subject.
     * This is a targeted update that modifies only the subject field,
     * leaving other session fields untouched. Use this instead of the full
     * update RPC when you only need to change the session subject.
     * &#64;internal
     * Server-side field-level update, race-safe. Atomically modifies only
     * spec.subject without touching other fields.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session updateSubject(ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateSubjectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's agent executions. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and execution identifiers.
     * Fails with FAILED_PRECONDITION while any agent execution in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * &#64;internal
     * Requires can_delete on the session (owner-only — sessions are personal
     * resources, so org admins have no implicit delete access).
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session delete(ai.stigmer.agentic.session.v1.SessionId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service SessionCommandController.
   * <pre>
   * SessionCommandController handles write operations for agent sessions.
   * </pre>
   */
  public static final class SessionCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<SessionCommandControllerFutureStub> {
    private SessionCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected SessionCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new SessionCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a session.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the session
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> apply(
        ai.stigmer.agentic.session.v1.Session request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a session.
     * &#64;internal
     * Requires can_create_session permission in the organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> create(
        ai.stigmer.agentic.session.v1.Session request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing session (e.g., subject, thread_id).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> update(
        ai.stigmer.agentic.session.v1.Session request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Set the session subject.
     * This is a targeted update that modifies only the subject field,
     * leaving other session fields untouched. Use this instead of the full
     * update RPC when you only need to change the session subject.
     * &#64;internal
     * Server-side field-level update, race-safe. Atomically modifies only
     * spec.subject without touching other fields.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> updateSubject(
        ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateSubjectMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's agent executions. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and execution identifiers.
     * Fails with FAILED_PRECONDITION while any agent execution in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * &#64;internal
     * Requires can_delete on the session (owner-only — sessions are personal
     * resources, so org admins have no implicit delete access).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> delete(
        ai.stigmer.agentic.session.v1.SessionId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_UPDATE_SUBJECT = 3;
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
          serviceImpl.apply((ai.stigmer.agentic.session.v1.Session) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.session.v1.Session) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.session.v1.Session) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session>) responseObserver);
          break;
        case METHODID_UPDATE_SUBJECT:
          serviceImpl.updateSubject((ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.session.v1.SessionId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session>) responseObserver);
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
              ai.stigmer.agentic.session.v1.Session,
              ai.stigmer.agentic.session.v1.Session>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.Session,
              ai.stigmer.agentic.session.v1.Session>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.Session,
              ai.stigmer.agentic.session.v1.Session>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateSubjectMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest,
              ai.stigmer.agentic.session.v1.Session>(
                service, METHODID_UPDATE_SUBJECT)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.SessionId,
              ai.stigmer.agentic.session.v1.Session>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class SessionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    SessionCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.session.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("SessionCommandController");
    }
  }

  private static final class SessionCommandControllerFileDescriptorSupplier
      extends SessionCommandControllerBaseDescriptorSupplier {
    SessionCommandControllerFileDescriptorSupplier() {}
  }

  private static final class SessionCommandControllerMethodDescriptorSupplier
      extends SessionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    SessionCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (SessionCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new SessionCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateSubjectMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
