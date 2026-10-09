package ai.stigmer.agentic.evaluator.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * EvaluatorCommandController handles write operations for evaluators.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class EvaluatorCommandControllerGrpc {

  private EvaluatorCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.evaluator.v1.EvaluatorCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.Evaluator,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.evaluator.v1.Evaluator.class,
      responseType = ai.stigmer.agentic.evaluator.v1.Evaluator.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.Evaluator,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.Evaluator, ai.stigmer.agentic.evaluator.v1.Evaluator> getCreateMethod;
    if ((getCreateMethod = EvaluatorCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (EvaluatorCommandControllerGrpc.class) {
        if ((getCreateMethod = EvaluatorCommandControllerGrpc.getCreateMethod) == null) {
          EvaluatorCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evaluator.v1.Evaluator, ai.stigmer.agentic.evaluator.v1.Evaluator>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.Evaluator.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.Evaluator.getDefaultInstance()))
              .setSchemaDescriptor(new EvaluatorCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.Evaluator,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.evaluator.v1.Evaluator.class,
      responseType = ai.stigmer.agentic.evaluator.v1.Evaluator.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.Evaluator,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.Evaluator, ai.stigmer.agentic.evaluator.v1.Evaluator> getUpdateMethod;
    if ((getUpdateMethod = EvaluatorCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (EvaluatorCommandControllerGrpc.class) {
        if ((getUpdateMethod = EvaluatorCommandControllerGrpc.getUpdateMethod) == null) {
          EvaluatorCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evaluator.v1.Evaluator, ai.stigmer.agentic.evaluator.v1.Evaluator>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.Evaluator.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.Evaluator.getDefaultInstance()))
              .setSchemaDescriptor(new EvaluatorCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.EvaluatorId,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.evaluator.v1.EvaluatorId.class,
      responseType = ai.stigmer.agentic.evaluator.v1.Evaluator.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.EvaluatorId,
      ai.stigmer.agentic.evaluator.v1.Evaluator> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.evaluator.v1.EvaluatorId, ai.stigmer.agentic.evaluator.v1.Evaluator> getDeleteMethod;
    if ((getDeleteMethod = EvaluatorCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (EvaluatorCommandControllerGrpc.class) {
        if ((getDeleteMethod = EvaluatorCommandControllerGrpc.getDeleteMethod) == null) {
          EvaluatorCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.evaluator.v1.EvaluatorId, ai.stigmer.agentic.evaluator.v1.Evaluator>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.EvaluatorId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.evaluator.v1.Evaluator.getDefaultInstance()))
              .setSchemaDescriptor(new EvaluatorCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static EvaluatorCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvaluatorCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvaluatorCommandControllerStub>() {
        @java.lang.Override
        public EvaluatorCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvaluatorCommandControllerStub(channel, callOptions);
        }
      };
    return EvaluatorCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static EvaluatorCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvaluatorCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvaluatorCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public EvaluatorCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvaluatorCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return EvaluatorCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static EvaluatorCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvaluatorCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvaluatorCommandControllerBlockingStub>() {
        @java.lang.Override
        public EvaluatorCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvaluatorCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return EvaluatorCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static EvaluatorCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<EvaluatorCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<EvaluatorCommandControllerFutureStub>() {
        @java.lang.Override
        public EvaluatorCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new EvaluatorCommandControllerFutureStub(channel, callOptions);
        }
      };
    return EvaluatorCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * EvaluatorCommandController handles write operations for evaluators.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create the evaluator that switches AI grading on for an agent.
     * An agent has at most one evaluator. The evaluator lives in its agent's
     * organization.
     * </pre>
     */
    default void create(ai.stigmer.agentic.evaluator.v1.Evaluator request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an evaluator's settings: whether it is enabled, its sample rate,
     * its monthly limit and its model.
     * The agent it grades stays as created, and this month's spend and
     * counts are kept.
     * </pre>
     */
    default void update(ai.stigmer.agentic.evaluator.v1.Evaluator request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an evaluator, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.evaluator.v1.EvaluatorId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service EvaluatorCommandController.
   * <pre>
   * EvaluatorCommandController handles write operations for evaluators.
   * </pre>
   */
  public static abstract class EvaluatorCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return EvaluatorCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service EvaluatorCommandController.
   * <pre>
   * EvaluatorCommandController handles write operations for evaluators.
   * </pre>
   */
  public static final class EvaluatorCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<EvaluatorCommandControllerStub> {
    private EvaluatorCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvaluatorCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvaluatorCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create the evaluator that switches AI grading on for an agent.
     * An agent has at most one evaluator. The evaluator lives in its agent's
     * organization.
     * </pre>
     */
    public void create(ai.stigmer.agentic.evaluator.v1.Evaluator request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an evaluator's settings: whether it is enabled, its sample rate,
     * its monthly limit and its model.
     * The agent it grades stays as created, and this month's spend and
     * counts are kept.
     * </pre>
     */
    public void update(ai.stigmer.agentic.evaluator.v1.Evaluator request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an evaluator, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.evaluator.v1.EvaluatorId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service EvaluatorCommandController.
   * <pre>
   * EvaluatorCommandController handles write operations for evaluators.
   * </pre>
   */
  public static final class EvaluatorCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<EvaluatorCommandControllerBlockingV2Stub> {
    private EvaluatorCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvaluatorCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvaluatorCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create the evaluator that switches AI grading on for an agent.
     * An agent has at most one evaluator. The evaluator lives in its agent's
     * organization.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator create(ai.stigmer.agentic.evaluator.v1.Evaluator request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an evaluator's settings: whether it is enabled, its sample rate,
     * its monthly limit and its model.
     * The agent it grades stays as created, and this month's spend and
     * counts are kept.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator update(ai.stigmer.agentic.evaluator.v1.Evaluator request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an evaluator, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator delete(ai.stigmer.agentic.evaluator.v1.EvaluatorId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service EvaluatorCommandController.
   * <pre>
   * EvaluatorCommandController handles write operations for evaluators.
   * </pre>
   */
  public static final class EvaluatorCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<EvaluatorCommandControllerBlockingStub> {
    private EvaluatorCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvaluatorCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvaluatorCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create the evaluator that switches AI grading on for an agent.
     * An agent has at most one evaluator. The evaluator lives in its agent's
     * organization.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator create(ai.stigmer.agentic.evaluator.v1.Evaluator request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an evaluator's settings: whether it is enabled, its sample rate,
     * its monthly limit and its model.
     * The agent it grades stays as created, and this month's spend and
     * counts are kept.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator update(ai.stigmer.agentic.evaluator.v1.Evaluator request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an evaluator, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    public ai.stigmer.agentic.evaluator.v1.Evaluator delete(ai.stigmer.agentic.evaluator.v1.EvaluatorId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service EvaluatorCommandController.
   * <pre>
   * EvaluatorCommandController handles write operations for evaluators.
   * </pre>
   */
  public static final class EvaluatorCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<EvaluatorCommandControllerFutureStub> {
    private EvaluatorCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected EvaluatorCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new EvaluatorCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create the evaluator that switches AI grading on for an agent.
     * An agent has at most one evaluator. The evaluator lives in its agent's
     * organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evaluator.v1.Evaluator> create(
        ai.stigmer.agentic.evaluator.v1.Evaluator request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an evaluator's settings: whether it is enabled, its sample rate,
     * its monthly limit and its model.
     * The agent it grades stays as created, and this month's spend and
     * counts are kept.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evaluator.v1.Evaluator> update(
        ai.stigmer.agentic.evaluator.v1.Evaluator request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an evaluator, switching AI grading off for its agent.
     * Scores already recorded stay on their runs.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.evaluator.v1.Evaluator> delete(
        ai.stigmer.agentic.evaluator.v1.EvaluatorId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
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
          serviceImpl.create((ai.stigmer.agentic.evaluator.v1.Evaluator) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.evaluator.v1.Evaluator) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.evaluator.v1.EvaluatorId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.evaluator.v1.Evaluator>) responseObserver);
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
              ai.stigmer.agentic.evaluator.v1.Evaluator,
              ai.stigmer.agentic.evaluator.v1.Evaluator>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.evaluator.v1.Evaluator,
              ai.stigmer.agentic.evaluator.v1.Evaluator>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.evaluator.v1.EvaluatorId,
              ai.stigmer.agentic.evaluator.v1.Evaluator>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class EvaluatorCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    EvaluatorCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.evaluator.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("EvaluatorCommandController");
    }
  }

  private static final class EvaluatorCommandControllerFileDescriptorSupplier
      extends EvaluatorCommandControllerBaseDescriptorSupplier {
    EvaluatorCommandControllerFileDescriptorSupplier() {}
  }

  private static final class EvaluatorCommandControllerMethodDescriptorSupplier
      extends EvaluatorCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    EvaluatorCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (EvaluatorCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new EvaluatorCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
