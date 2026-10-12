package ai.stigmer.agentic.agenteval.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentEvalCommandController handles write operations for agent evals.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentEvalCommandControllerGrpc {

  private AgentEvalCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agenteval.v1.AgentEvalCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEval,
      ai.stigmer.agentic.agenteval.v1.AgentEval> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.agenteval.v1.AgentEval.class,
      responseType = ai.stigmer.agentic.agenteval.v1.AgentEval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEval,
      ai.stigmer.agentic.agenteval.v1.AgentEval> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEval, ai.stigmer.agentic.agenteval.v1.AgentEval> getCreateMethod;
    if ((getCreateMethod = AgentEvalCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (AgentEvalCommandControllerGrpc.class) {
        if ((getCreateMethod = AgentEvalCommandControllerGrpc.getCreateMethod) == null) {
          AgentEvalCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agenteval.v1.AgentEval, ai.stigmer.agentic.agenteval.v1.AgentEval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.AgentEval.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.AgentEval.getDefaultInstance()))
              .setSchemaDescriptor(new AgentEvalCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEvalId,
      ai.stigmer.agentic.agenteval.v1.AgentEval> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.agentic.agenteval.v1.AgentEvalId.class,
      responseType = ai.stigmer.agentic.agenteval.v1.AgentEval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEvalId,
      ai.stigmer.agentic.agenteval.v1.AgentEval> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEvalId, ai.stigmer.agentic.agenteval.v1.AgentEval> getCancelMethod;
    if ((getCancelMethod = AgentEvalCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (AgentEvalCommandControllerGrpc.class) {
        if ((getCancelMethod = AgentEvalCommandControllerGrpc.getCancelMethod) == null) {
          AgentEvalCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agenteval.v1.AgentEvalId, ai.stigmer.agentic.agenteval.v1.AgentEval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.AgentEvalId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.AgentEval.getDefaultInstance()))
              .setSchemaDescriptor(new AgentEvalCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEvalId,
      ai.stigmer.agentic.agenteval.v1.AgentEval> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.agenteval.v1.AgentEvalId.class,
      responseType = ai.stigmer.agentic.agenteval.v1.AgentEval.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEvalId,
      ai.stigmer.agentic.agenteval.v1.AgentEval> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agenteval.v1.AgentEvalId, ai.stigmer.agentic.agenteval.v1.AgentEval> getDeleteMethod;
    if ((getDeleteMethod = AgentEvalCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (AgentEvalCommandControllerGrpc.class) {
        if ((getDeleteMethod = AgentEvalCommandControllerGrpc.getDeleteMethod) == null) {
          AgentEvalCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agenteval.v1.AgentEvalId, ai.stigmer.agentic.agenteval.v1.AgentEval>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.AgentEvalId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agenteval.v1.AgentEval.getDefaultInstance()))
              .setSchemaDescriptor(new AgentEvalCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentEvalCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentEvalCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentEvalCommandControllerStub>() {
        @java.lang.Override
        public AgentEvalCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentEvalCommandControllerStub(channel, callOptions);
        }
      };
    return AgentEvalCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentEvalCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentEvalCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentEvalCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentEvalCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentEvalCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentEvalCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentEvalCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentEvalCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentEvalCommandControllerBlockingStub>() {
        @java.lang.Override
        public AgentEvalCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentEvalCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentEvalCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentEvalCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentEvalCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentEvalCommandControllerFutureStub>() {
        @java.lang.Override
        public AgentEvalCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentEvalCommandControllerFutureStub(channel, callOptions);
        }
      };
    return AgentEvalCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentEvalCommandController handles write operations for agent evals.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Start an eval of an agent on its plugins' eval cases.
     * The eval lives in its agent's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    default void create(ai.stigmer.agentic.agenteval.v1.AgentEval request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    default void cancel(ai.stigmer.agentic.agenteval.v1.AgentEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.agenteval.v1.AgentEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentEvalCommandController.
   * <pre>
   * AgentEvalCommandController handles write operations for agent evals.
   * </pre>
   */
  public static abstract class AgentEvalCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentEvalCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentEvalCommandController.
   * <pre>
   * AgentEvalCommandController handles write operations for agent evals.
   * </pre>
   */
  public static final class AgentEvalCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentEvalCommandControllerStub> {
    private AgentEvalCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentEvalCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentEvalCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval of an agent on its plugins' eval cases.
     * The eval lives in its agent's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public void create(ai.stigmer.agentic.agenteval.v1.AgentEval request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    public void cancel(ai.stigmer.agentic.agenteval.v1.AgentEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.agenteval.v1.AgentEvalId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentEvalCommandController.
   * <pre>
   * AgentEvalCommandController handles write operations for agent evals.
   * </pre>
   */
  public static final class AgentEvalCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentEvalCommandControllerBlockingV2Stub> {
    private AgentEvalCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentEvalCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentEvalCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval of an agent on its plugins' eval cases.
     * The eval lives in its agent's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEval create(ai.stigmer.agentic.agenteval.v1.AgentEval request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEval cancel(ai.stigmer.agentic.agenteval.v1.AgentEvalId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEval delete(ai.stigmer.agentic.agenteval.v1.AgentEvalId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentEvalCommandController.
   * <pre>
   * AgentEvalCommandController handles write operations for agent evals.
   * </pre>
   */
  public static final class AgentEvalCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentEvalCommandControllerBlockingStub> {
    private AgentEvalCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentEvalCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentEvalCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval of an agent on its plugins' eval cases.
     * The eval lives in its agent's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEval create(ai.stigmer.agentic.agenteval.v1.AgentEval request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEval cancel(ai.stigmer.agentic.agenteval.v1.AgentEvalId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    public ai.stigmer.agentic.agenteval.v1.AgentEval delete(ai.stigmer.agentic.agenteval.v1.AgentEvalId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentEvalCommandController.
   * <pre>
   * AgentEvalCommandController handles write operations for agent evals.
   * </pre>
   */
  public static final class AgentEvalCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentEvalCommandControllerFutureStub> {
    private AgentEvalCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentEvalCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentEvalCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Start an eval of an agent on its plugins' eval cases.
     * The eval lives in its agent's organization, which pays for every try.
     * It returns at once, pending; get it again to follow its progress.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agenteval.v1.AgentEval> create(
        ai.stigmer.agentic.agenteval.v1.AgentEval request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel a pending or running eval.
     * Tries in flight are stopped; the eval ends partial, "cancelled", with
     * the results of the tries that finished. Cancelling a finished eval
     * changes nothing.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agenteval.v1.AgentEval> cancel(
        ai.stigmer.agentic.agenteval.v1.AgentEvalId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an eval with its tries' conversations, runs and scores.
     * A pending or running eval is refused: cancel it first.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agenteval.v1.AgentEval> delete(
        ai.stigmer.agentic.agenteval.v1.AgentEvalId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_CANCEL = 1;
  private static final int METHODID_DELETE = 2;

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
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.agenteval.v1.AgentEval) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.agentic.agenteval.v1.AgentEvalId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.agenteval.v1.AgentEvalId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agenteval.v1.AgentEval>) responseObserver);
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
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agenteval.v1.AgentEval,
              ai.stigmer.agentic.agenteval.v1.AgentEval>(
                service, METHODID_CREATE)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agenteval.v1.AgentEvalId,
              ai.stigmer.agentic.agenteval.v1.AgentEval>(
                service, METHODID_CANCEL)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agenteval.v1.AgentEvalId,
              ai.stigmer.agentic.agenteval.v1.AgentEval>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class AgentEvalCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentEvalCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agenteval.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentEvalCommandController");
    }
  }

  private static final class AgentEvalCommandControllerFileDescriptorSupplier
      extends AgentEvalCommandControllerBaseDescriptorSupplier {
    AgentEvalCommandControllerFileDescriptorSupplier() {}
  }

  private static final class AgentEvalCommandControllerMethodDescriptorSupplier
      extends AgentEvalCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentEvalCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentEvalCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentEvalCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getCancelMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
