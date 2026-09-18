package ai.stigmer.billing.plan.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * PlanQueryController provides the read operations on the plan catalog.
 * The catalog is readable by every signed-in caller: the console shows it
 * when an organization chooses a plan, and a retired plan stays readable so
 * an existing subscription can show what it bought. It is not public: a
 * public list would put every seeded row, Enterprise tiers and retired terms
 * included, in front of anyone.
 * &#64;internal
 * Served by the cloud composition only (the kind is cloud_only). Both RPCs
 * are is_skip_authorization although get carries an id: the kind's
 * authorization scope is AUTHORIZATION_SCOPE_TYPE_NONE, so no tuple exists
 * to check a caller against, and "any authenticated caller, no permission"
 * has no other spelling in the annotation vocabulary. This is the one
 * exception the proto-modelling guide grants to its rule against skipping
 * on an id-carrying request; the handler performs no further check.
 * Relaxing to public later is additive; tightening later would break a
 * caller.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class PlanQueryControllerGrpc {

  private PlanQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.plan.v1.PlanQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.PlanId,
      ai.stigmer.billing.plan.v1.Plan> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.billing.plan.v1.PlanId.class,
      responseType = ai.stigmer.billing.plan.v1.Plan.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.PlanId,
      ai.stigmer.billing.plan.v1.Plan> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.PlanId, ai.stigmer.billing.plan.v1.Plan> getGetMethod;
    if ((getGetMethod = PlanQueryControllerGrpc.getGetMethod) == null) {
      synchronized (PlanQueryControllerGrpc.class) {
        if ((getGetMethod = PlanQueryControllerGrpc.getGetMethod) == null) {
          PlanQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.plan.v1.PlanId, ai.stigmer.billing.plan.v1.Plan>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.plan.v1.PlanId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.plan.v1.Plan.getDefaultInstance()))
              .setSchemaDescriptor(new PlanQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.ListPlansInput,
      ai.stigmer.billing.plan.v1.Plans> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.billing.plan.v1.ListPlansInput.class,
      responseType = ai.stigmer.billing.plan.v1.Plans.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.ListPlansInput,
      ai.stigmer.billing.plan.v1.Plans> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.plan.v1.ListPlansInput, ai.stigmer.billing.plan.v1.Plans> getListMethod;
    if ((getListMethod = PlanQueryControllerGrpc.getListMethod) == null) {
      synchronized (PlanQueryControllerGrpc.class) {
        if ((getListMethod = PlanQueryControllerGrpc.getListMethod) == null) {
          PlanQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.plan.v1.ListPlansInput, ai.stigmer.billing.plan.v1.Plans>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.plan.v1.ListPlansInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.plan.v1.Plans.getDefaultInstance()))
              .setSchemaDescriptor(new PlanQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static PlanQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlanQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlanQueryControllerStub>() {
        @java.lang.Override
        public PlanQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlanQueryControllerStub(channel, callOptions);
        }
      };
    return PlanQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static PlanQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlanQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlanQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public PlanQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlanQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return PlanQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static PlanQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlanQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlanQueryControllerBlockingStub>() {
        @java.lang.Override
        public PlanQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlanQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return PlanQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static PlanQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<PlanQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<PlanQueryControllerFutureStub>() {
        @java.lang.Override
        public PlanQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new PlanQueryControllerFutureStub(channel, callOptions);
        }
      };
    return PlanQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * PlanQueryController provides the read operations on the plan catalog.
   * The catalog is readable by every signed-in caller: the console shows it
   * when an organization chooses a plan, and a retired plan stays readable so
   * an existing subscription can show what it bought. It is not public: a
   * public list would put every seeded row, Enterprise tiers and retired terms
   * included, in front of anyone.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * are is_skip_authorization although get carries an id: the kind's
   * authorization scope is AUTHORIZATION_SCOPE_TYPE_NONE, so no tuple exists
   * to check a caller against, and "any authenticated caller, no permission"
   * has no other spelling in the annotation vocabulary. This is the one
   * exception the proto-modelling guide grants to its rule against skipping
   * on an id-carrying request; the handler performs no further check.
   * Relaxing to public later is additive; tightening later would break a
   * caller.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a plan by its unique identifier.
     * Any signed-in caller may read any plan, retired plans included.
     * </pre>
     */
    default void get(ai.stigmer.billing.plan.v1.PlanId request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plan> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the plans in the catalog.
     * Returns the active plans; set include_retired to see retired ones too.
     * Any signed-in caller may list.
     * </pre>
     */
    default void list(ai.stigmer.billing.plan.v1.ListPlansInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plans> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service PlanQueryController.
   * <pre>
   * PlanQueryController provides the read operations on the plan catalog.
   * The catalog is readable by every signed-in caller: the console shows it
   * when an organization chooses a plan, and a retired plan stays readable so
   * an existing subscription can show what it bought. It is not public: a
   * public list would put every seeded row, Enterprise tiers and retired terms
   * included, in front of anyone.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * are is_skip_authorization although get carries an id: the kind's
   * authorization scope is AUTHORIZATION_SCOPE_TYPE_NONE, so no tuple exists
   * to check a caller against, and "any authenticated caller, no permission"
   * has no other spelling in the annotation vocabulary. This is the one
   * exception the proto-modelling guide grants to its rule against skipping
   * on an id-carrying request; the handler performs no further check.
   * Relaxing to public later is additive; tightening later would break a
   * caller.
   * </pre>
   */
  public static abstract class PlanQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return PlanQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service PlanQueryController.
   * <pre>
   * PlanQueryController provides the read operations on the plan catalog.
   * The catalog is readable by every signed-in caller: the console shows it
   * when an organization chooses a plan, and a retired plan stays readable so
   * an existing subscription can show what it bought. It is not public: a
   * public list would put every seeded row, Enterprise tiers and retired terms
   * included, in front of anyone.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * are is_skip_authorization although get carries an id: the kind's
   * authorization scope is AUTHORIZATION_SCOPE_TYPE_NONE, so no tuple exists
   * to check a caller against, and "any authenticated caller, no permission"
   * has no other spelling in the annotation vocabulary. This is the one
   * exception the proto-modelling guide grants to its rule against skipping
   * on an id-carrying request; the handler performs no further check.
   * Relaxing to public later is additive; tightening later would break a
   * caller.
   * </pre>
   */
  public static final class PlanQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<PlanQueryControllerStub> {
    private PlanQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlanQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlanQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a plan by its unique identifier.
     * Any signed-in caller may read any plan, retired plans included.
     * </pre>
     */
    public void get(ai.stigmer.billing.plan.v1.PlanId request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plan> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the plans in the catalog.
     * Returns the active plans; set include_retired to see retired ones too.
     * Any signed-in caller may list.
     * </pre>
     */
    public void list(ai.stigmer.billing.plan.v1.ListPlansInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plans> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service PlanQueryController.
   * <pre>
   * PlanQueryController provides the read operations on the plan catalog.
   * The catalog is readable by every signed-in caller: the console shows it
   * when an organization chooses a plan, and a retired plan stays readable so
   * an existing subscription can show what it bought. It is not public: a
   * public list would put every seeded row, Enterprise tiers and retired terms
   * included, in front of anyone.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * are is_skip_authorization although get carries an id: the kind's
   * authorization scope is AUTHORIZATION_SCOPE_TYPE_NONE, so no tuple exists
   * to check a caller against, and "any authenticated caller, no permission"
   * has no other spelling in the annotation vocabulary. This is the one
   * exception the proto-modelling guide grants to its rule against skipping
   * on an id-carrying request; the handler performs no further check.
   * Relaxing to public later is additive; tightening later would break a
   * caller.
   * </pre>
   */
  public static final class PlanQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<PlanQueryControllerBlockingV2Stub> {
    private PlanQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlanQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlanQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a plan by its unique identifier.
     * Any signed-in caller may read any plan, retired plans included.
     * </pre>
     */
    public ai.stigmer.billing.plan.v1.Plan get(ai.stigmer.billing.plan.v1.PlanId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the plans in the catalog.
     * Returns the active plans; set include_retired to see retired ones too.
     * Any signed-in caller may list.
     * </pre>
     */
    public ai.stigmer.billing.plan.v1.Plans list(ai.stigmer.billing.plan.v1.ListPlansInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service PlanQueryController.
   * <pre>
   * PlanQueryController provides the read operations on the plan catalog.
   * The catalog is readable by every signed-in caller: the console shows it
   * when an organization chooses a plan, and a retired plan stays readable so
   * an existing subscription can show what it bought. It is not public: a
   * public list would put every seeded row, Enterprise tiers and retired terms
   * included, in front of anyone.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * are is_skip_authorization although get carries an id: the kind's
   * authorization scope is AUTHORIZATION_SCOPE_TYPE_NONE, so no tuple exists
   * to check a caller against, and "any authenticated caller, no permission"
   * has no other spelling in the annotation vocabulary. This is the one
   * exception the proto-modelling guide grants to its rule against skipping
   * on an id-carrying request; the handler performs no further check.
   * Relaxing to public later is additive; tightening later would break a
   * caller.
   * </pre>
   */
  public static final class PlanQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<PlanQueryControllerBlockingStub> {
    private PlanQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlanQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlanQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a plan by its unique identifier.
     * Any signed-in caller may read any plan, retired plans included.
     * </pre>
     */
    public ai.stigmer.billing.plan.v1.Plan get(ai.stigmer.billing.plan.v1.PlanId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the plans in the catalog.
     * Returns the active plans; set include_retired to see retired ones too.
     * Any signed-in caller may list.
     * </pre>
     */
    public ai.stigmer.billing.plan.v1.Plans list(ai.stigmer.billing.plan.v1.ListPlansInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service PlanQueryController.
   * <pre>
   * PlanQueryController provides the read operations on the plan catalog.
   * The catalog is readable by every signed-in caller: the console shows it
   * when an organization chooses a plan, and a retired plan stays readable so
   * an existing subscription can show what it bought. It is not public: a
   * public list would put every seeded row, Enterprise tiers and retired terms
   * included, in front of anyone.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Both RPCs
   * are is_skip_authorization although get carries an id: the kind's
   * authorization scope is AUTHORIZATION_SCOPE_TYPE_NONE, so no tuple exists
   * to check a caller against, and "any authenticated caller, no permission"
   * has no other spelling in the annotation vocabulary. This is the one
   * exception the proto-modelling guide grants to its rule against skipping
   * on an id-carrying request; the handler performs no further check.
   * Relaxing to public later is additive; tightening later would break a
   * caller.
   * </pre>
   */
  public static final class PlanQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<PlanQueryControllerFutureStub> {
    private PlanQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected PlanQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new PlanQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a plan by its unique identifier.
     * Any signed-in caller may read any plan, retired plans included.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.plan.v1.Plan> get(
        ai.stigmer.billing.plan.v1.PlanId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the plans in the catalog.
     * Returns the active plans; set include_retired to see retired ones too.
     * Any signed-in caller may list.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.plan.v1.Plans> list(
        ai.stigmer.billing.plan.v1.ListPlansInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST = 1;

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
          serviceImpl.get((ai.stigmer.billing.plan.v1.PlanId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plan>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.billing.plan.v1.ListPlansInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.plan.v1.Plans>) responseObserver);
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
              ai.stigmer.billing.plan.v1.PlanId,
              ai.stigmer.billing.plan.v1.Plan>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.plan.v1.ListPlansInput,
              ai.stigmer.billing.plan.v1.Plans>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class PlanQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    PlanQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.plan.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("PlanQueryController");
    }
  }

  private static final class PlanQueryControllerFileDescriptorSupplier
      extends PlanQueryControllerBaseDescriptorSupplier {
    PlanQueryControllerFileDescriptorSupplier() {}
  }

  private static final class PlanQueryControllerMethodDescriptorSupplier
      extends PlanQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    PlanQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (PlanQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new PlanQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
