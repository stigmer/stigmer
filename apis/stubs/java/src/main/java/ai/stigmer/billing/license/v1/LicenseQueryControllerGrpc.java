package ai.stigmer.billing.license.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * LicenseQueryController provides the read operations on issued licenses.
 * A license carries a customer's name and a ticket that unlocks a server, so
 * every read is a platform operator act on the static platform target, with
 * the same permission that issues.
 * &#64;internal
 * Served by the cloud composition only (the kind is cloud_only). Authorizes
 * against platform:stigmer with can_issue_license.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class LicenseQueryControllerGrpc {

  private LicenseQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.license.v1.LicenseQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.license.v1.LicenseId,
      ai.stigmer.billing.license.v1.License> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.billing.license.v1.LicenseId.class,
      responseType = ai.stigmer.billing.license.v1.License.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.license.v1.LicenseId,
      ai.stigmer.billing.license.v1.License> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.license.v1.LicenseId, ai.stigmer.billing.license.v1.License> getGetMethod;
    if ((getGetMethod = LicenseQueryControllerGrpc.getGetMethod) == null) {
      synchronized (LicenseQueryControllerGrpc.class) {
        if ((getGetMethod = LicenseQueryControllerGrpc.getGetMethod) == null) {
          LicenseQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.license.v1.LicenseId, ai.stigmer.billing.license.v1.License>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.license.v1.LicenseId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.license.v1.License.getDefaultInstance()))
              .setSchemaDescriptor(new LicenseQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.license.v1.ListLicensesInput,
      ai.stigmer.billing.license.v1.Licenses> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.billing.license.v1.ListLicensesInput.class,
      responseType = ai.stigmer.billing.license.v1.Licenses.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.license.v1.ListLicensesInput,
      ai.stigmer.billing.license.v1.Licenses> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.license.v1.ListLicensesInput, ai.stigmer.billing.license.v1.Licenses> getListMethod;
    if ((getListMethod = LicenseQueryControllerGrpc.getListMethod) == null) {
      synchronized (LicenseQueryControllerGrpc.class) {
        if ((getListMethod = LicenseQueryControllerGrpc.getListMethod) == null) {
          LicenseQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.license.v1.ListLicensesInput, ai.stigmer.billing.license.v1.Licenses>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.license.v1.ListLicensesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.license.v1.Licenses.getDefaultInstance()))
              .setSchemaDescriptor(new LicenseQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static LicenseQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<LicenseQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<LicenseQueryControllerStub>() {
        @java.lang.Override
        public LicenseQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new LicenseQueryControllerStub(channel, callOptions);
        }
      };
    return LicenseQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static LicenseQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<LicenseQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<LicenseQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public LicenseQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new LicenseQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return LicenseQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static LicenseQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<LicenseQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<LicenseQueryControllerBlockingStub>() {
        @java.lang.Override
        public LicenseQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new LicenseQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return LicenseQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static LicenseQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<LicenseQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<LicenseQueryControllerFutureStub>() {
        @java.lang.Override
        public LicenseQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new LicenseQueryControllerFutureStub(channel, callOptions);
        }
      };
    return LicenseQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * LicenseQueryController provides the read operations on issued licenses.
   * A license carries a customer's name and a ticket that unlocks a server, so
   * every read is a platform operator act on the static platform target, with
   * the same permission that issues.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a license by its unique identifier.
     * </pre>
     */
    default void get(ai.stigmer.billing.license.v1.LicenseId request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.license.v1.License> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List issued licenses, optionally for one customer.
     * </pre>
     */
    default void list(ai.stigmer.billing.license.v1.ListLicensesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.license.v1.Licenses> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service LicenseQueryController.
   * <pre>
   * LicenseQueryController provides the read operations on issued licenses.
   * A license carries a customer's name and a ticket that unlocks a server, so
   * every read is a platform operator act on the static platform target, with
   * the same permission that issues.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license.
   * </pre>
   */
  public static abstract class LicenseQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return LicenseQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service LicenseQueryController.
   * <pre>
   * LicenseQueryController provides the read operations on issued licenses.
   * A license carries a customer's name and a ticket that unlocks a server, so
   * every read is a platform operator act on the static platform target, with
   * the same permission that issues.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license.
   * </pre>
   */
  public static final class LicenseQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<LicenseQueryControllerStub> {
    private LicenseQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected LicenseQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new LicenseQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a license by its unique identifier.
     * </pre>
     */
    public void get(ai.stigmer.billing.license.v1.LicenseId request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.license.v1.License> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List issued licenses, optionally for one customer.
     * </pre>
     */
    public void list(ai.stigmer.billing.license.v1.ListLicensesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.license.v1.Licenses> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service LicenseQueryController.
   * <pre>
   * LicenseQueryController provides the read operations on issued licenses.
   * A license carries a customer's name and a ticket that unlocks a server, so
   * every read is a platform operator act on the static platform target, with
   * the same permission that issues.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license.
   * </pre>
   */
  public static final class LicenseQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<LicenseQueryControllerBlockingV2Stub> {
    private LicenseQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected LicenseQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new LicenseQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a license by its unique identifier.
     * </pre>
     */
    public ai.stigmer.billing.license.v1.License get(ai.stigmer.billing.license.v1.LicenseId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List issued licenses, optionally for one customer.
     * </pre>
     */
    public ai.stigmer.billing.license.v1.Licenses list(ai.stigmer.billing.license.v1.ListLicensesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service LicenseQueryController.
   * <pre>
   * LicenseQueryController provides the read operations on issued licenses.
   * A license carries a customer's name and a ticket that unlocks a server, so
   * every read is a platform operator act on the static platform target, with
   * the same permission that issues.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license.
   * </pre>
   */
  public static final class LicenseQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<LicenseQueryControllerBlockingStub> {
    private LicenseQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected LicenseQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new LicenseQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a license by its unique identifier.
     * </pre>
     */
    public ai.stigmer.billing.license.v1.License get(ai.stigmer.billing.license.v1.LicenseId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List issued licenses, optionally for one customer.
     * </pre>
     */
    public ai.stigmer.billing.license.v1.Licenses list(ai.stigmer.billing.license.v1.ListLicensesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service LicenseQueryController.
   * <pre>
   * LicenseQueryController provides the read operations on issued licenses.
   * A license carries a customer's name and a ticket that unlocks a server, so
   * every read is a platform operator act on the static platform target, with
   * the same permission that issues.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license.
   * </pre>
   */
  public static final class LicenseQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<LicenseQueryControllerFutureStub> {
    private LicenseQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected LicenseQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new LicenseQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a license by its unique identifier.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.license.v1.License> get(
        ai.stigmer.billing.license.v1.LicenseId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List issued licenses, optionally for one customer.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.license.v1.Licenses> list(
        ai.stigmer.billing.license.v1.ListLicensesInput request) {
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
          serviceImpl.get((ai.stigmer.billing.license.v1.LicenseId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.license.v1.License>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.billing.license.v1.ListLicensesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.license.v1.Licenses>) responseObserver);
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
              ai.stigmer.billing.license.v1.LicenseId,
              ai.stigmer.billing.license.v1.License>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.billing.license.v1.ListLicensesInput,
              ai.stigmer.billing.license.v1.Licenses>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class LicenseQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    LicenseQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.license.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("LicenseQueryController");
    }
  }

  private static final class LicenseQueryControllerFileDescriptorSupplier
      extends LicenseQueryControllerBaseDescriptorSupplier {
    LicenseQueryControllerFileDescriptorSupplier() {}
  }

  private static final class LicenseQueryControllerMethodDescriptorSupplier
      extends LicenseQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    LicenseQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (LicenseQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new LicenseQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
