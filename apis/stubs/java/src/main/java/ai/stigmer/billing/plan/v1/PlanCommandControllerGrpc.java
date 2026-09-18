package ai.stigmer.billing.plan.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * PlanCommandController provides the write operations on the plan catalog.
 * A plan is immutable once created, so there is no update: a change of terms
 * is a new Plan and a retire on the old one. Both operations are platform
 * operator acts on the static platform target.
 * &#64;internal
 * Served by the cloud composition only (the kind is cloud_only). Both RPCs
 * authorize against platform:stigmer with can_manage_plans, the same
 * operator seat can_manage_model_pricing uses; the relation lands in the
 * authorization model with the entry that serves the kind.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PlanCommandControllerGrpc {

  private PlanCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.plan.v1.PlanCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.Plan,
      ai.stigmer.billing.plan.v1.Plan> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.billing.plan.v1.Plan.class,
      responseType = ai.stigmer.billing.plan.v1.Plan.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.Plan,
      ai.stigmer.billing.plan.v1.Plan> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.Plan, ai.stigmer.billing.plan.v1.Plan> getCreateMethod;
    if ((getCreateMethod = PlanCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (PlanCommandControllerGrpc.class) {
        if ((getCreateMethod = PlanCommandControllerGrpc.getCreateMethod) == null) {
          PlanCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.plan.v1.Plan, ai.stigmer.billing.plan.v1.Plan>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.plan.v1.Plan.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.plan.v1.Plan.getDefaultInstance()))
              .setSchemaDescriptor(new PlanCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.PlanId,
      ai.stigmer.billing.plan.v1.Plan> getRetireMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "retire",
      requestType = ai.stigmer.billing.plan.v1.PlanId.class,
      responseType = ai.stigmer.billing.plan.v1.Plan.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.PlanId,
      ai.stigmer.billing.plan.v1.Plan> getRetireMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.PlanId, ai.stigmer.billing.plan.v1.Plan> getRetireMethod;
    if ((getRetireMethod = PlanCommandControllerGrpc.getRetireMethod) == null) {
      synchronized (PlanCommandControllerGrpc.class) {
        if ((getRetireMethod = PlanCommandControllerGrpc.getRetireMethod) == null) {
          PlanCommandControllerGrpc.getRetireMethod = getRetireMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.plan.v1.PlanId, ai.stigmer.billing.plan.v1.Plan>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "retire"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.plan.v1.PlanId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.plan.v1.Plan.getDefaultInstance()))
              .setSchemaDescriptor(new PlanCommandControllerMethodDescriptorSupplier("retire"))
              .build();
        }
      }
    }
    return getRetireMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PlanCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlanCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlanCommandControllerStub>() {
        @java.lang.Override
        public PlanCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlanCommandControllerStub(channel, callOptions);
        }
      };
    return PlanCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PlanCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlanCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlanCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public PlanCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlanCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PlanCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PlanCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlanCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlanCommandControllerBlockingStub>() {
        @java.lang.Override
        public PlanCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlanCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return PlanCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PlanCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlanCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlanCommandControllerFutureStub>() {
        @java.lang.Override
        public PlanCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlanCommandControllerFutureStub(channel, callOptions);
        }
      };
    return PlanCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * PlanCommandController provides the write operations on the plan catalog.
   * A plan is immutable once created, so there is no update: a change of terms
   * is a new Plan and a retire on the old one. Both operations are platform
   * operator acts on the static platform target.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * authorize against platform:stigmer with can_manage_plans, the same
   * operator seat can_manage_model_pricing uses; the relation lands in the
   * authorization model with the entry that serves the kind.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a plan.
     * The plan's slug is its stable handle and must be unique across the
     * catalog. The spec is final at create: to change any term, create a new
     * Plan and retire this one.
     * </pre>
     */
    default void create(ai.stigmer.billing.plan.v1.Plan request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plan> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Retire a plan so it can no longer be bought.
     * Existing subscriptions and licenses on the plan keep it; the plan stays
     * readable so they can show their terms. Retiring an already retired plan
     * changes nothing.
     * </pre>
     */
    default void retire(ai.stigmer.billing.plan.v1.PlanId request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plan> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRetireMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PlanCommandController.
   * <pre>
   * PlanCommandController provides the write operations on the plan catalog.
   * A plan is immutable once created, so there is no update: a change of terms
   * is a new Plan and a retire on the old one. Both operations are platform
   * operator acts on the static platform target.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * authorize against platform:stigmer with can_manage_plans, the same
   * operator seat can_manage_model_pricing uses; the relation lands in the
   * authorization model with the entry that serves the kind.
   * </pre>
   */
  public static abstract class PlanCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PlanCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PlanCommandController.
   * <pre>
   * PlanCommandController provides the write operations on the plan catalog.
   * A plan is immutable once created, so there is no update: a change of terms
   * is a new Plan and a retire on the old one. Both operations are platform
   * operator acts on the static platform target.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * authorize against platform:stigmer with can_manage_plans, the same
   * operator seat can_manage_model_pricing uses; the relation lands in the
   * authorization model with the entry that serves the kind.
   * </pre>
   */
  public static final class PlanCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PlanCommandControllerStub> {
    private PlanCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlanCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlanCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a plan.
     * The plan's slug is its stable handle and must be unique across the
     * catalog. The spec is final at create: to change any term, create a new
     * Plan and retire this one.
     * </pre>
     */
    public void create(ai.stigmer.billing.plan.v1.Plan request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plan> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Retire a plan so it can no longer be bought.
     * Existing subscriptions and licenses on the plan keep it; the plan stays
     * readable so they can show their terms. Retiring an already retired plan
     * changes nothing.
     * </pre>
     */
    public void retire(ai.stigmer.billing.plan.v1.PlanId request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plan> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRetireMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PlanCommandController.
   * <pre>
   * PlanCommandController provides the write operations on the plan catalog.
   * A plan is immutable once created, so there is no update: a change of terms
   * is a new Plan and a retire on the old one. Both operations are platform
   * operator acts on the static platform target.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * authorize against platform:stigmer with can_manage_plans, the same
   * operator seat can_manage_model_pricing uses; the relation lands in the
   * authorization model with the entry that serves the kind.
   * </pre>
   */
  public static final class PlanCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PlanCommandControllerBlockingV2Stub> {
    private PlanCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlanCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlanCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a plan.
     * The plan's slug is its stable handle and must be unique across the
     * catalog. The spec is final at create: to change any term, create a new
     * Plan and retire this one.
     * </pre>
     */
    public ai.stigmer.billing.plan.v1.Plan create(ai.stigmer.billing.plan.v1.Plan request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retire a plan so it can no longer be bought.
     * Existing subscriptions and licenses on the plan keep it; the plan stays
     * readable so they can show their terms. Retiring an already retired plan
     * changes nothing.
     * </pre>
     */
    public ai.stigmer.billing.plan.v1.Plan retire(ai.stigmer.billing.plan.v1.PlanId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRetireMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PlanCommandController.
   * <pre>
   * PlanCommandController provides the write operations on the plan catalog.
   * A plan is immutable once created, so there is no update: a change of terms
   * is a new Plan and a retire on the old one. Both operations are platform
   * operator acts on the static platform target.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * authorize against platform:stigmer with can_manage_plans, the same
   * operator seat can_manage_model_pricing uses; the relation lands in the
   * authorization model with the entry that serves the kind.
   * </pre>
   */
  public static final class PlanCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PlanCommandControllerBlockingStub> {
    private PlanCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlanCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlanCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a plan.
     * The plan's slug is its stable handle and must be unique across the
     * catalog. The spec is final at create: to change any term, create a new
     * Plan and retire this one.
     * </pre>
     */
    public ai.stigmer.billing.plan.v1.Plan create(ai.stigmer.billing.plan.v1.Plan request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Retire a plan so it can no longer be bought.
     * Existing subscriptions and licenses on the plan keep it; the plan stays
     * readable so they can show their terms. Retiring an already retired plan
     * changes nothing.
     * </pre>
     */
    public ai.stigmer.billing.plan.v1.Plan retire(ai.stigmer.billing.plan.v1.PlanId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRetireMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PlanCommandController.
   * <pre>
   * PlanCommandController provides the write operations on the plan catalog.
   * A plan is immutable once created, so there is no update: a change of terms
   * is a new Plan and a retire on the old one. Both operations are platform
   * operator acts on the static platform target.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * authorize against platform:stigmer with can_manage_plans, the same
   * operator seat can_manage_model_pricing uses; the relation lands in the
   * authorization model with the entry that serves the kind.
   * </pre>
   */
  public static final class PlanCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PlanCommandControllerFutureStub> {
    private PlanCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlanCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlanCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a plan.
     * The plan's slug is its stable handle and must be unique across the
     * catalog. The spec is final at create: to change any term, create a new
     * Plan and retire this one.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.plan.v1.Plan> create(
        ai.stigmer.billing.plan.v1.Plan request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Retire a plan so it can no longer be bought.
     * Existing subscriptions and licenses on the plan keep it; the plan stays
     * readable so they can show their terms. Retiring an already retired plan
     * changes nothing.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.plan.v1.Plan> retire(
        ai.stigmer.billing.plan.v1.PlanId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRetireMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_RETIRE = 1;

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
          serviceImpl.create((ai.stigmer.billing.plan.v1.Plan) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plan>) responseObserver);
          break;
        case METHODID_RETIRE:
          serviceImpl.retire((ai.stigmer.billing.plan.v1.PlanId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plan>) responseObserver);
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
              ai.stigmer.billing.plan.v1.Plan,
              ai.stigmer.billing.plan.v1.Plan>(
                service, METHODID_CREATE)))
        .addMethod(
          getRetireMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.plan.v1.PlanId,
              ai.stigmer.billing.plan.v1.Plan>(
                service, METHODID_RETIRE)))
        .build();
  }

  private static abstract class PlanCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PlanCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.plan.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PlanCommandController");
    }
  }

  private static final class PlanCommandControllerFileDescriptorSupplier
      extends PlanCommandControllerBaseDescriptorSupplier {
    PlanCommandControllerFileDescriptorSupplier() {}
  }

  private static final class PlanCommandControllerMethodDescriptorSupplier
      extends PlanCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PlanCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PlanCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PlanCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getRetireMethod())
              .build();
        }
      }
    }
    return result;
  }
}
