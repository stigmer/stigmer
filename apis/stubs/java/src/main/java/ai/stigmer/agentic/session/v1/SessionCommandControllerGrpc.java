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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.UpdateSessionInput,
      ai.stigmer.agentic.session.v1.Session> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.session.v1.UpdateSessionInput.class,
      responseType = ai.stigmer.agentic.session.v1.Session.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.UpdateSessionInput,
      ai.stigmer.agentic.session.v1.Session> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.UpdateSessionInput, ai.stigmer.agentic.session.v1.Session> getUpdateMethod;
    if ((getUpdateMethod = SessionCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getUpdateMethod = SessionCommandControllerGrpc.getUpdateMethod) == null) {
          SessionCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.UpdateSessionInput, ai.stigmer.agentic.session.v1.Session>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.UpdateSessionInput.getDefaultInstance()))
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ReviewFileChangesInput,
      ai.stigmer.agentic.session.v1.ReviewFileChangesResponse> getReviewFileChangesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "reviewFileChanges",
      requestType = ai.stigmer.agentic.session.v1.ReviewFileChangesInput.class,
      responseType = ai.stigmer.agentic.session.v1.ReviewFileChangesResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ReviewFileChangesInput,
      ai.stigmer.agentic.session.v1.ReviewFileChangesResponse> getReviewFileChangesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ReviewFileChangesInput, ai.stigmer.agentic.session.v1.ReviewFileChangesResponse> getReviewFileChangesMethod;
    if ((getReviewFileChangesMethod = SessionCommandControllerGrpc.getReviewFileChangesMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getReviewFileChangesMethod = SessionCommandControllerGrpc.getReviewFileChangesMethod) == null) {
          SessionCommandControllerGrpc.getReviewFileChangesMethod = getReviewFileChangesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.ReviewFileChangesInput, ai.stigmer.agentic.session.v1.ReviewFileChangesResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "reviewFileChanges"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.ReviewFileChangesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.ReviewFileChangesResponse.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("reviewFileChanges"))
              .build();
        }
      }
    }
    return getReviewFileChangesMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ConfirmToolUseInput,
      ai.stigmer.agentic.session.v1.SessionEvent> getConfirmToolUseMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "confirmToolUse",
      requestType = ai.stigmer.agentic.session.v1.ConfirmToolUseInput.class,
      responseType = ai.stigmer.agentic.session.v1.SessionEvent.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ConfirmToolUseInput,
      ai.stigmer.agentic.session.v1.SessionEvent> getConfirmToolUseMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.ConfirmToolUseInput, ai.stigmer.agentic.session.v1.SessionEvent> getConfirmToolUseMethod;
    if ((getConfirmToolUseMethod = SessionCommandControllerGrpc.getConfirmToolUseMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getConfirmToolUseMethod = SessionCommandControllerGrpc.getConfirmToolUseMethod) == null) {
          SessionCommandControllerGrpc.getConfirmToolUseMethod = getConfirmToolUseMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.ConfirmToolUseInput, ai.stigmer.agentic.session.v1.SessionEvent>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "confirmToolUse"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.ConfirmToolUseInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.SessionEvent.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("confirmToolUse"))
              .build();
        }
      }
    }
    return getConfirmToolUseMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.GrantPermissionInput,
      ai.stigmer.agentic.session.v1.GrantPermissionResponse> getGrantPermissionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "grantPermission",
      requestType = ai.stigmer.agentic.session.v1.GrantPermissionInput.class,
      responseType = ai.stigmer.agentic.session.v1.GrantPermissionResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.GrantPermissionInput,
      ai.stigmer.agentic.session.v1.GrantPermissionResponse> getGrantPermissionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.GrantPermissionInput, ai.stigmer.agentic.session.v1.GrantPermissionResponse> getGrantPermissionMethod;
    if ((getGrantPermissionMethod = SessionCommandControllerGrpc.getGrantPermissionMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getGrantPermissionMethod = SessionCommandControllerGrpc.getGrantPermissionMethod) == null) {
          SessionCommandControllerGrpc.getGrantPermissionMethod = getGrantPermissionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.GrantPermissionInput, ai.stigmer.agentic.session.v1.GrantPermissionResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "grantPermission"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.GrantPermissionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.GrantPermissionResponse.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("grantPermission"))
              .build();
        }
      }
    }
    return getGrantPermissionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.InterruptSessionInput,
      ai.stigmer.agentic.session.v1.InterruptSessionResponse> getInterruptMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "interrupt",
      requestType = ai.stigmer.agentic.session.v1.InterruptSessionInput.class,
      responseType = ai.stigmer.agentic.session.v1.InterruptSessionResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.InterruptSessionInput,
      ai.stigmer.agentic.session.v1.InterruptSessionResponse> getInterruptMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.InterruptSessionInput, ai.stigmer.agentic.session.v1.InterruptSessionResponse> getInterruptMethod;
    if ((getInterruptMethod = SessionCommandControllerGrpc.getInterruptMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getInterruptMethod = SessionCommandControllerGrpc.getInterruptMethod) == null) {
          SessionCommandControllerGrpc.getInterruptMethod = getInterruptMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.InterruptSessionInput, ai.stigmer.agentic.session.v1.InterruptSessionResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "interrupt"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.InterruptSessionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.InterruptSessionResponse.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("interrupt"))
              .build();
        }
      }
    }
    return getInterruptMethod;
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.AppendSessionEventsInput,
      ai.stigmer.agentic.session.v1.AppendSessionEventsResponse> getAppendEventsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "appendEvents",
      requestType = ai.stigmer.agentic.session.v1.AppendSessionEventsInput.class,
      responseType = ai.stigmer.agentic.session.v1.AppendSessionEventsResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.AppendSessionEventsInput,
      ai.stigmer.agentic.session.v1.AppendSessionEventsResponse> getAppendEventsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.AppendSessionEventsInput, ai.stigmer.agentic.session.v1.AppendSessionEventsResponse> getAppendEventsMethod;
    if ((getAppendEventsMethod = SessionCommandControllerGrpc.getAppendEventsMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getAppendEventsMethod = SessionCommandControllerGrpc.getAppendEventsMethod) == null) {
          SessionCommandControllerGrpc.getAppendEventsMethod = getAppendEventsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.AppendSessionEventsInput, ai.stigmer.agentic.session.v1.AppendSessionEventsResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "appendEvents"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.AppendSessionEventsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.AppendSessionEventsResponse.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("appendEvents"))
              .build();
        }
      }
    }
    return getAppendEventsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.BindHarnessStateInput,
      ai.stigmer.agentic.session.v1.BindHarnessStateResponse> getBindHarnessStateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "bindHarnessState",
      requestType = ai.stigmer.agentic.session.v1.BindHarnessStateInput.class,
      responseType = ai.stigmer.agentic.session.v1.BindHarnessStateResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.BindHarnessStateInput,
      ai.stigmer.agentic.session.v1.BindHarnessStateResponse> getBindHarnessStateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.session.v1.BindHarnessStateInput, ai.stigmer.agentic.session.v1.BindHarnessStateResponse> getBindHarnessStateMethod;
    if ((getBindHarnessStateMethod = SessionCommandControllerGrpc.getBindHarnessStateMethod) == null) {
      synchronized (SessionCommandControllerGrpc.class) {
        if ((getBindHarnessStateMethod = SessionCommandControllerGrpc.getBindHarnessStateMethod) == null) {
          SessionCommandControllerGrpc.getBindHarnessStateMethod = getBindHarnessStateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.session.v1.BindHarnessStateInput, ai.stigmer.agentic.session.v1.BindHarnessStateResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "bindHarnessState"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.BindHarnessStateInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.session.v1.BindHarnessStateResponse.getDefaultInstance()))
              .setSchemaDescriptor(new SessionCommandControllerMethodDescriptorSupplier("bindHarnessState"))
              .build();
        }
      }
    }
    return getBindHarnessStateMethod;
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
     * </pre>
     */
    default void apply(ai.stigmer.agentic.session.v1.Session request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a session.
     * </pre>
     */
    default void create(ai.stigmer.agentic.session.v1.Session request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a session: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the session; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the session does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the session changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the session kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    default void update(ai.stigmer.agentic.session.v1.UpdateSessionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Set the session subject.
     * This is a targeted update that modifies only the subject field,
     * leaving other session fields untouched. Use this instead of the full
     * update RPC when you only need to change the session subject.
     * </pre>
     */
    default void updateSubject(ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateSubjectMethod(), responseObserver);
    }

    /**
     * <pre>
     * Keep or undo the file changes a turn made, or one of its files.
     * In a conversation with file review on (SessionSpec.file_review), each
     * turn's file edits are applied as the agent makes them and listed in a
     * stigmer.file_review.changes event. They can be decided until the
     * conversation's next message is sent; then whatever is undecided is
     * kept. Keep records the choice. Undo puts the file back as it was
     * before the turn: at once when the turn has ended (the reply names the
     * turn that does it), else when the turn's next step starts. The
     * decision is appended as a stigmer.file_review.decided event.
     * ## Error Conditions
     * - NOT_FOUND: the change set is not one of this conversation's
     * - FAILED_PRECONDITION: the conversation has moved on (a later message
     *   was sent), the change was already decided the other way (a decision
     *   is final), the file is not in the change set, or a keep of a change
     *   that cannot be shown whole without acknowledge_unreviewable
     * - INVALID_ARGUMENT: expected_digest does not match the change
     * ## Idempotency
     * The same decision sent again records nothing new and starts no second
     * turn.
     * </pre>
     */
    default void reviewFileChanges(ai.stigmer.agentic.session.v1.ReviewFileChangesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.ReviewFileChangesResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getReviewFileChangesMethod(), responseObserver);
    }

    /**
     * <pre>
     * Allow or deny a tool use that waits for an answer.
     * A call that needs a person's answer is an agent.tool_use (or
     * agent.mcp_tool_use) with evaluated_permission ask, and the session goes
     * idle with stop_reason requires_action naming it. The answer is appended
     * as a user.tool_confirmation. A deny may carry a message, which the
     * agent reads. When every waiting call of the turn is answered, the turn
     * resumes; until then the session re-states requires_action with the
     * calls still waiting.
     * ## Error Conditions
     * - NOT_FOUND: the tool use is not one of this conversation's calls that
     *   asked
     * - FAILED_PRECONDITION: the call no longer waits (its turn moved on or
     *   was stopped), or it was already answered the other way (an answer is
     *   final)
     * ## Idempotency
     * The same answer sent again records nothing new and returns the event
     * first recorded.
     * </pre>
     */
    default void confirmToolUse(ai.stigmer.agentic.session.v1.ConfirmToolUseInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.SessionEvent> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getConfirmToolUseMethod(), responseObserver);
    }

    /**
     * <pre>
     * Allow a tool use, and every call of its class for the rest of the turn.
     * The class is the call's built-in category (write, delete or shell), its
     * MCP server, or, when a hook asked, that hook on that tool. The grant is
     * appended as a stigmer.permission.grant after the call's
     * user.tool_confirmation, and every other call of the class waiting in
     * the same turn is allowed with it. A call with no class (one the
     * default never asks about) is allowed alone, with no grant.
     * ## Error Conditions
     * As confirmToolUse.
     * ## Idempotency
     * The same grant sent again records nothing new.
     * </pre>
     */
    default void grantPermission(ai.stigmer.agentic.session.v1.GrantPermissionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.GrantPermissionResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGrantPermissionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Stop the session's unfinished work.
     * Appends a user.interrupt and stops every unfinished turn of the
     * conversation: queued, working, waiting for an answer or paused. Each
     * ends cancelled and the session goes idle with end_turn. Files undone
     * in a turn that waited are put back at once.
     * ## Error Conditions
     * - INVALID_ARGUMENT: session_thread_id is set (one thread alone cannot
     *   be stopped)
     * - FAILED_PRECONDITION: the execution engine is not connected
     * ## Idempotency
     * An interrupt with nothing unfinished records the event and stops
     * nothing.
     * </pre>
     */
    default void interrupt(ai.stigmer.agentic.session.v1.InterruptSessionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.InterruptSessionResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getInterruptMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's runs. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and run identifiers.
     * Fails with FAILED_PRECONDITION while any run in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.session.v1.SessionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Append a run's events to its session's log.
     * Only the runner acting for the run may call it, while the run is not
     * finished. It accepts the events a runner produces: agent.*,
     * session.thread_* and session.error. The batch is appended whole or not
     * at all.
     * </pre>
     */
    default void appendEvents(ai.stigmer.agentic.session.v1.AppendSessionEventsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.AppendSessionEventsResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getAppendEventsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Record the harness's conversation id for a run's session.
     * Only the runner acting for the run may call it, while the run is not
     * finished. The id replaced, if any, joins the session's
     * harness_state_id_history.
     * </pre>
     */
    default void bindHarnessState(ai.stigmer.agentic.session.v1.BindHarnessStateInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.BindHarnessStateResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getBindHarnessStateMethod(), responseObserver);
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
     * </pre>
     */
    public void create(ai.stigmer.agentic.session.v1.Session request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a session: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the session; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the session does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the session changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the session kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public void update(ai.stigmer.agentic.session.v1.UpdateSessionInput request,
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
     * </pre>
     */
    public void updateSubject(ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateSubjectMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Keep or undo the file changes a turn made, or one of its files.
     * In a conversation with file review on (SessionSpec.file_review), each
     * turn's file edits are applied as the agent makes them and listed in a
     * stigmer.file_review.changes event. They can be decided until the
     * conversation's next message is sent; then whatever is undecided is
     * kept. Keep records the choice. Undo puts the file back as it was
     * before the turn: at once when the turn has ended (the reply names the
     * turn that does it), else when the turn's next step starts. The
     * decision is appended as a stigmer.file_review.decided event.
     * ## Error Conditions
     * - NOT_FOUND: the change set is not one of this conversation's
     * - FAILED_PRECONDITION: the conversation has moved on (a later message
     *   was sent), the change was already decided the other way (a decision
     *   is final), the file is not in the change set, or a keep of a change
     *   that cannot be shown whole without acknowledge_unreviewable
     * - INVALID_ARGUMENT: expected_digest does not match the change
     * ## Idempotency
     * The same decision sent again records nothing new and starts no second
     * turn.
     * </pre>
     */
    public void reviewFileChanges(ai.stigmer.agentic.session.v1.ReviewFileChangesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.ReviewFileChangesResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getReviewFileChangesMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Allow or deny a tool use that waits for an answer.
     * A call that needs a person's answer is an agent.tool_use (or
     * agent.mcp_tool_use) with evaluated_permission ask, and the session goes
     * idle with stop_reason requires_action naming it. The answer is appended
     * as a user.tool_confirmation. A deny may carry a message, which the
     * agent reads. When every waiting call of the turn is answered, the turn
     * resumes; until then the session re-states requires_action with the
     * calls still waiting.
     * ## Error Conditions
     * - NOT_FOUND: the tool use is not one of this conversation's calls that
     *   asked
     * - FAILED_PRECONDITION: the call no longer waits (its turn moved on or
     *   was stopped), or it was already answered the other way (an answer is
     *   final)
     * ## Idempotency
     * The same answer sent again records nothing new and returns the event
     * first recorded.
     * </pre>
     */
    public void confirmToolUse(ai.stigmer.agentic.session.v1.ConfirmToolUseInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.SessionEvent> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getConfirmToolUseMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Allow a tool use, and every call of its class for the rest of the turn.
     * The class is the call's built-in category (write, delete or shell), its
     * MCP server, or, when a hook asked, that hook on that tool. The grant is
     * appended as a stigmer.permission.grant after the call's
     * user.tool_confirmation, and every other call of the class waiting in
     * the same turn is allowed with it. A call with no class (one the
     * default never asks about) is allowed alone, with no grant.
     * ## Error Conditions
     * As confirmToolUse.
     * ## Idempotency
     * The same grant sent again records nothing new.
     * </pre>
     */
    public void grantPermission(ai.stigmer.agentic.session.v1.GrantPermissionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.GrantPermissionResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGrantPermissionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Stop the session's unfinished work.
     * Appends a user.interrupt and stops every unfinished turn of the
     * conversation: queued, working, waiting for an answer or paused. Each
     * ends cancelled and the session goes idle with end_turn. Files undone
     * in a turn that waited are put back at once.
     * ## Error Conditions
     * - INVALID_ARGUMENT: session_thread_id is set (one thread alone cannot
     *   be stopped)
     * - FAILED_PRECONDITION: the execution engine is not connected
     * ## Idempotency
     * An interrupt with nothing unfinished records the event and stops
     * nothing.
     * </pre>
     */
    public void interrupt(ai.stigmer.agentic.session.v1.InterruptSessionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.InterruptSessionResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getInterruptMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's runs. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and run identifiers.
     * Fails with FAILED_PRECONDITION while any run in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.session.v1.SessionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Append a run's events to its session's log.
     * Only the runner acting for the run may call it, while the run is not
     * finished. It accepts the events a runner produces: agent.*,
     * session.thread_* and session.error. The batch is appended whole or not
     * at all.
     * </pre>
     */
    public void appendEvents(ai.stigmer.agentic.session.v1.AppendSessionEventsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.AppendSessionEventsResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getAppendEventsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Record the harness's conversation id for a run's session.
     * Only the runner acting for the run may call it, while the run is not
     * finished. The id replaced, if any, joins the session's
     * harness_state_id_history.
     * </pre>
     */
    public void bindHarnessState(ai.stigmer.agentic.session.v1.BindHarnessStateInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.BindHarnessStateResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getBindHarnessStateMethod(), getCallOptions()), request, responseObserver);
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
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session apply(ai.stigmer.agentic.session.v1.Session request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a session.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session create(ai.stigmer.agentic.session.v1.Session request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a session: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the session; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the session does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the session changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the session kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session update(ai.stigmer.agentic.session.v1.UpdateSessionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Set the session subject.
     * This is a targeted update that modifies only the subject field,
     * leaving other session fields untouched. Use this instead of the full
     * update RPC when you only need to change the session subject.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session updateSubject(ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateSubjectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Keep or undo the file changes a turn made, or one of its files.
     * In a conversation with file review on (SessionSpec.file_review), each
     * turn's file edits are applied as the agent makes them and listed in a
     * stigmer.file_review.changes event. They can be decided until the
     * conversation's next message is sent; then whatever is undecided is
     * kept. Keep records the choice. Undo puts the file back as it was
     * before the turn: at once when the turn has ended (the reply names the
     * turn that does it), else when the turn's next step starts. The
     * decision is appended as a stigmer.file_review.decided event.
     * ## Error Conditions
     * - NOT_FOUND: the change set is not one of this conversation's
     * - FAILED_PRECONDITION: the conversation has moved on (a later message
     *   was sent), the change was already decided the other way (a decision
     *   is final), the file is not in the change set, or a keep of a change
     *   that cannot be shown whole without acknowledge_unreviewable
     * - INVALID_ARGUMENT: expected_digest does not match the change
     * ## Idempotency
     * The same decision sent again records nothing new and starts no second
     * turn.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.ReviewFileChangesResponse reviewFileChanges(ai.stigmer.agentic.session.v1.ReviewFileChangesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getReviewFileChangesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Allow or deny a tool use that waits for an answer.
     * A call that needs a person's answer is an agent.tool_use (or
     * agent.mcp_tool_use) with evaluated_permission ask, and the session goes
     * idle with stop_reason requires_action naming it. The answer is appended
     * as a user.tool_confirmation. A deny may carry a message, which the
     * agent reads. When every waiting call of the turn is answered, the turn
     * resumes; until then the session re-states requires_action with the
     * calls still waiting.
     * ## Error Conditions
     * - NOT_FOUND: the tool use is not one of this conversation's calls that
     *   asked
     * - FAILED_PRECONDITION: the call no longer waits (its turn moved on or
     *   was stopped), or it was already answered the other way (an answer is
     *   final)
     * ## Idempotency
     * The same answer sent again records nothing new and returns the event
     * first recorded.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.SessionEvent confirmToolUse(ai.stigmer.agentic.session.v1.ConfirmToolUseInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getConfirmToolUseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Allow a tool use, and every call of its class for the rest of the turn.
     * The class is the call's built-in category (write, delete or shell), its
     * MCP server, or, when a hook asked, that hook on that tool. The grant is
     * appended as a stigmer.permission.grant after the call's
     * user.tool_confirmation, and every other call of the class waiting in
     * the same turn is allowed with it. A call with no class (one the
     * default never asks about) is allowed alone, with no grant.
     * ## Error Conditions
     * As confirmToolUse.
     * ## Idempotency
     * The same grant sent again records nothing new.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.GrantPermissionResponse grantPermission(ai.stigmer.agentic.session.v1.GrantPermissionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGrantPermissionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Stop the session's unfinished work.
     * Appends a user.interrupt and stops every unfinished turn of the
     * conversation: queued, working, waiting for an answer or paused. Each
     * ends cancelled and the session goes idle with end_turn. Files undone
     * in a turn that waited are put back at once.
     * ## Error Conditions
     * - INVALID_ARGUMENT: session_thread_id is set (one thread alone cannot
     *   be stopped)
     * - FAILED_PRECONDITION: the execution engine is not connected
     * ## Idempotency
     * An interrupt with nothing unfinished records the event and stops
     * nothing.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.InterruptSessionResponse interrupt(ai.stigmer.agentic.session.v1.InterruptSessionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getInterruptMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's runs. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and run identifiers.
     * Fails with FAILED_PRECONDITION while any run in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session delete(ai.stigmer.agentic.session.v1.SessionId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Append a run's events to its session's log.
     * Only the runner acting for the run may call it, while the run is not
     * finished. It accepts the events a runner produces: agent.*,
     * session.thread_* and session.error. The batch is appended whole or not
     * at all.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.AppendSessionEventsResponse appendEvents(ai.stigmer.agentic.session.v1.AppendSessionEventsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getAppendEventsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Record the harness's conversation id for a run's session.
     * Only the runner acting for the run may call it, while the run is not
     * finished. The id replaced, if any, joins the session's
     * harness_state_id_history.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.BindHarnessStateResponse bindHarnessState(ai.stigmer.agentic.session.v1.BindHarnessStateInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getBindHarnessStateMethod(), getCallOptions(), request);
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
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session apply(ai.stigmer.agentic.session.v1.Session request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a session.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session create(ai.stigmer.agentic.session.v1.Session request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a session: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the session; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the session does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the session changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the session kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session update(ai.stigmer.agentic.session.v1.UpdateSessionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Set the session subject.
     * This is a targeted update that modifies only the subject field,
     * leaving other session fields untouched. Use this instead of the full
     * update RPC when you only need to change the session subject.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session updateSubject(ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateSubjectMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Keep or undo the file changes a turn made, or one of its files.
     * In a conversation with file review on (SessionSpec.file_review), each
     * turn's file edits are applied as the agent makes them and listed in a
     * stigmer.file_review.changes event. They can be decided until the
     * conversation's next message is sent; then whatever is undecided is
     * kept. Keep records the choice. Undo puts the file back as it was
     * before the turn: at once when the turn has ended (the reply names the
     * turn that does it), else when the turn's next step starts. The
     * decision is appended as a stigmer.file_review.decided event.
     * ## Error Conditions
     * - NOT_FOUND: the change set is not one of this conversation's
     * - FAILED_PRECONDITION: the conversation has moved on (a later message
     *   was sent), the change was already decided the other way (a decision
     *   is final), the file is not in the change set, or a keep of a change
     *   that cannot be shown whole without acknowledge_unreviewable
     * - INVALID_ARGUMENT: expected_digest does not match the change
     * ## Idempotency
     * The same decision sent again records nothing new and starts no second
     * turn.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.ReviewFileChangesResponse reviewFileChanges(ai.stigmer.agentic.session.v1.ReviewFileChangesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getReviewFileChangesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Allow or deny a tool use that waits for an answer.
     * A call that needs a person's answer is an agent.tool_use (or
     * agent.mcp_tool_use) with evaluated_permission ask, and the session goes
     * idle with stop_reason requires_action naming it. The answer is appended
     * as a user.tool_confirmation. A deny may carry a message, which the
     * agent reads. When every waiting call of the turn is answered, the turn
     * resumes; until then the session re-states requires_action with the
     * calls still waiting.
     * ## Error Conditions
     * - NOT_FOUND: the tool use is not one of this conversation's calls that
     *   asked
     * - FAILED_PRECONDITION: the call no longer waits (its turn moved on or
     *   was stopped), or it was already answered the other way (an answer is
     *   final)
     * ## Idempotency
     * The same answer sent again records nothing new and returns the event
     * first recorded.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.SessionEvent confirmToolUse(ai.stigmer.agentic.session.v1.ConfirmToolUseInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getConfirmToolUseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Allow a tool use, and every call of its class for the rest of the turn.
     * The class is the call's built-in category (write, delete or shell), its
     * MCP server, or, when a hook asked, that hook on that tool. The grant is
     * appended as a stigmer.permission.grant after the call's
     * user.tool_confirmation, and every other call of the class waiting in
     * the same turn is allowed with it. A call with no class (one the
     * default never asks about) is allowed alone, with no grant.
     * ## Error Conditions
     * As confirmToolUse.
     * ## Idempotency
     * The same grant sent again records nothing new.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.GrantPermissionResponse grantPermission(ai.stigmer.agentic.session.v1.GrantPermissionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGrantPermissionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Stop the session's unfinished work.
     * Appends a user.interrupt and stops every unfinished turn of the
     * conversation: queued, working, waiting for an answer or paused. Each
     * ends cancelled and the session goes idle with end_turn. Files undone
     * in a turn that waited are put back at once.
     * ## Error Conditions
     * - INVALID_ARGUMENT: session_thread_id is set (one thread alone cannot
     *   be stopped)
     * - FAILED_PRECONDITION: the execution engine is not connected
     * ## Idempotency
     * An interrupt with nothing unfinished records the event and stops
     * nothing.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.InterruptSessionResponse interrupt(ai.stigmer.agentic.session.v1.InterruptSessionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getInterruptMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's runs. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and run identifiers.
     * Fails with FAILED_PRECONDITION while any run in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.Session delete(ai.stigmer.agentic.session.v1.SessionId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Append a run's events to its session's log.
     * Only the runner acting for the run may call it, while the run is not
     * finished. It accepts the events a runner produces: agent.*,
     * session.thread_* and session.error. The batch is appended whole or not
     * at all.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.AppendSessionEventsResponse appendEvents(ai.stigmer.agentic.session.v1.AppendSessionEventsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getAppendEventsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Record the harness's conversation id for a run's session.
     * Only the runner acting for the run may call it, while the run is not
     * finished. The id replaced, if any, joins the session's
     * harness_state_id_history.
     * </pre>
     */
    public ai.stigmer.agentic.session.v1.BindHarnessStateResponse bindHarnessState(ai.stigmer.agentic.session.v1.BindHarnessStateInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getBindHarnessStateMethod(), getCallOptions(), request);
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
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> create(
        ai.stigmer.agentic.session.v1.Session request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a session: the fields update_mask names change, every other
     * field keeps its stored value.
     * resource.metadata.id names the session; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the session does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the session changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the session kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> update(
        ai.stigmer.agentic.session.v1.UpdateSessionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Set the session subject.
     * This is a targeted update that modifies only the subject field,
     * leaving other session fields untouched. Use this instead of the full
     * update RPC when you only need to change the session subject.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> updateSubject(
        ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateSubjectMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Keep or undo the file changes a turn made, or one of its files.
     * In a conversation with file review on (SessionSpec.file_review), each
     * turn's file edits are applied as the agent makes them and listed in a
     * stigmer.file_review.changes event. They can be decided until the
     * conversation's next message is sent; then whatever is undecided is
     * kept. Keep records the choice. Undo puts the file back as it was
     * before the turn: at once when the turn has ended (the reply names the
     * turn that does it), else when the turn's next step starts. The
     * decision is appended as a stigmer.file_review.decided event.
     * ## Error Conditions
     * - NOT_FOUND: the change set is not one of this conversation's
     * - FAILED_PRECONDITION: the conversation has moved on (a later message
     *   was sent), the change was already decided the other way (a decision
     *   is final), the file is not in the change set, or a keep of a change
     *   that cannot be shown whole without acknowledge_unreviewable
     * - INVALID_ARGUMENT: expected_digest does not match the change
     * ## Idempotency
     * The same decision sent again records nothing new and starts no second
     * turn.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.ReviewFileChangesResponse> reviewFileChanges(
        ai.stigmer.agentic.session.v1.ReviewFileChangesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getReviewFileChangesMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Allow or deny a tool use that waits for an answer.
     * A call that needs a person's answer is an agent.tool_use (or
     * agent.mcp_tool_use) with evaluated_permission ask, and the session goes
     * idle with stop_reason requires_action naming it. The answer is appended
     * as a user.tool_confirmation. A deny may carry a message, which the
     * agent reads. When every waiting call of the turn is answered, the turn
     * resumes; until then the session re-states requires_action with the
     * calls still waiting.
     * ## Error Conditions
     * - NOT_FOUND: the tool use is not one of this conversation's calls that
     *   asked
     * - FAILED_PRECONDITION: the call no longer waits (its turn moved on or
     *   was stopped), or it was already answered the other way (an answer is
     *   final)
     * ## Idempotency
     * The same answer sent again records nothing new and returns the event
     * first recorded.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.SessionEvent> confirmToolUse(
        ai.stigmer.agentic.session.v1.ConfirmToolUseInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getConfirmToolUseMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Allow a tool use, and every call of its class for the rest of the turn.
     * The class is the call's built-in category (write, delete or shell), its
     * MCP server, or, when a hook asked, that hook on that tool. The grant is
     * appended as a stigmer.permission.grant after the call's
     * user.tool_confirmation, and every other call of the class waiting in
     * the same turn is allowed with it. A call with no class (one the
     * default never asks about) is allowed alone, with no grant.
     * ## Error Conditions
     * As confirmToolUse.
     * ## Idempotency
     * The same grant sent again records nothing new.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.GrantPermissionResponse> grantPermission(
        ai.stigmer.agentic.session.v1.GrantPermissionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGrantPermissionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Stop the session's unfinished work.
     * Appends a user.interrupt and stops every unfinished turn of the
     * conversation: queued, working, waiting for an answer or paused. Each
     * ends cancelled and the session goes idle with end_turn. Files undone
     * in a turn that waited are put back at once.
     * ## Error Conditions
     * - INVALID_ARGUMENT: session_thread_id is set (one thread alone cannot
     *   be stopped)
     * - FAILED_PRECONDITION: the execution engine is not connected
     * ## Idempotency
     * An interrupt with nothing unfinished records the event and stops
     * nothing.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.InterruptSessionResponse> interrupt(
        ai.stigmer.agentic.session.v1.InterruptSessionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getInterruptMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a session.
     * Deletion cascades to the session's runs. Billing usage
     * records are immutable and unaffected — they carry their own copies of
     * the session and run identifiers.
     * Fails with FAILED_PRECONDITION while any run in the
     * session is still active (pending, in progress, waiting for approval,
     * or paused); cancel it or wait for it to finish first.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.Session> delete(
        ai.stigmer.agentic.session.v1.SessionId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Append a run's events to its session's log.
     * Only the runner acting for the run may call it, while the run is not
     * finished. It accepts the events a runner produces: agent.*,
     * session.thread_* and session.error. The batch is appended whole or not
     * at all.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.AppendSessionEventsResponse> appendEvents(
        ai.stigmer.agentic.session.v1.AppendSessionEventsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getAppendEventsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Record the harness's conversation id for a run's session.
     * Only the runner acting for the run may call it, while the run is not
     * finished. The id replaced, if any, joins the session's
     * harness_state_id_history.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.session.v1.BindHarnessStateResponse> bindHarnessState(
        ai.stigmer.agentic.session.v1.BindHarnessStateInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getBindHarnessStateMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_UPDATE_SUBJECT = 3;
  private static final int METHODID_REVIEW_FILE_CHANGES = 4;
  private static final int METHODID_CONFIRM_TOOL_USE = 5;
  private static final int METHODID_GRANT_PERMISSION = 6;
  private static final int METHODID_INTERRUPT = 7;
  private static final int METHODID_DELETE = 8;
  private static final int METHODID_APPEND_EVENTS = 9;
  private static final int METHODID_BIND_HARNESS_STATE = 10;

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
          serviceImpl.update((ai.stigmer.agentic.session.v1.UpdateSessionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session>) responseObserver);
          break;
        case METHODID_UPDATE_SUBJECT:
          serviceImpl.updateSubject((ai.stigmer.agentic.session.v1.UpdateSessionSubjectRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session>) responseObserver);
          break;
        case METHODID_REVIEW_FILE_CHANGES:
          serviceImpl.reviewFileChanges((ai.stigmer.agentic.session.v1.ReviewFileChangesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.ReviewFileChangesResponse>) responseObserver);
          break;
        case METHODID_CONFIRM_TOOL_USE:
          serviceImpl.confirmToolUse((ai.stigmer.agentic.session.v1.ConfirmToolUseInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.SessionEvent>) responseObserver);
          break;
        case METHODID_GRANT_PERMISSION:
          serviceImpl.grantPermission((ai.stigmer.agentic.session.v1.GrantPermissionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.GrantPermissionResponse>) responseObserver);
          break;
        case METHODID_INTERRUPT:
          serviceImpl.interrupt((ai.stigmer.agentic.session.v1.InterruptSessionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.InterruptSessionResponse>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.session.v1.SessionId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.Session>) responseObserver);
          break;
        case METHODID_APPEND_EVENTS:
          serviceImpl.appendEvents((ai.stigmer.agentic.session.v1.AppendSessionEventsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.AppendSessionEventsResponse>) responseObserver);
          break;
        case METHODID_BIND_HARNESS_STATE:
          serviceImpl.bindHarnessState((ai.stigmer.agentic.session.v1.BindHarnessStateInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.session.v1.BindHarnessStateResponse>) responseObserver);
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
              ai.stigmer.agentic.session.v1.UpdateSessionInput,
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
          getReviewFileChangesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.ReviewFileChangesInput,
              ai.stigmer.agentic.session.v1.ReviewFileChangesResponse>(
                service, METHODID_REVIEW_FILE_CHANGES)))
        .addMethod(
          getConfirmToolUseMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.ConfirmToolUseInput,
              ai.stigmer.agentic.session.v1.SessionEvent>(
                service, METHODID_CONFIRM_TOOL_USE)))
        .addMethod(
          getGrantPermissionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.GrantPermissionInput,
              ai.stigmer.agentic.session.v1.GrantPermissionResponse>(
                service, METHODID_GRANT_PERMISSION)))
        .addMethod(
          getInterruptMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.InterruptSessionInput,
              ai.stigmer.agentic.session.v1.InterruptSessionResponse>(
                service, METHODID_INTERRUPT)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.SessionId,
              ai.stigmer.agentic.session.v1.Session>(
                service, METHODID_DELETE)))
        .addMethod(
          getAppendEventsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.AppendSessionEventsInput,
              ai.stigmer.agentic.session.v1.AppendSessionEventsResponse>(
                service, METHODID_APPEND_EVENTS)))
        .addMethod(
          getBindHarnessStateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.session.v1.BindHarnessStateInput,
              ai.stigmer.agentic.session.v1.BindHarnessStateResponse>(
                service, METHODID_BIND_HARNESS_STATE)))
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
              .addMethod(getReviewFileChangesMethod())
              .addMethod(getConfirmToolUseMethod())
              .addMethod(getGrantPermissionMethod())
              .addMethod(getInterruptMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getAppendEventsMethod())
              .addMethod(getBindHarnessStateMethod())
              .build();
        }
      }
    }
    return result;
  }
}
