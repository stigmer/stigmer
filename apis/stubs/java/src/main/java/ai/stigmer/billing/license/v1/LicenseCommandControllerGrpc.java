package ai.stigmer.billing.license.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * LicenseCommandController provides the write operations on licenses.
 * Issuing is the one write: the claims are immutable once signed, so there
 * is no update, and a renewal or a change of entitlements is a new License.
 * Issuing is a platform operator act on the static platform target. A
 * self-serve trial door, if one is offered, is a separate public entry the
 * issuer adds beside this controller; it is not this RPC relaxed.
 * &#64;internal
 * Served by the cloud composition only (the kind is cloud_only). Authorizes
 * against platform:stigmer with can_issue_license; the relation lands in
 * the authorization model with the entry that serves the kind. The
 * issuer signs with an Ed25519 key held in the platform's vault, distinct
 * from the runtime token-signing key, and records the ticket in the status.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class LicenseCommandControllerGrpc {

  private LicenseCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.billing.license.v1.LicenseCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.billing.license.v1.License,
      ai.stigmer.billing.license.v1.License> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.billing.license.v1.License.class,
      responseType = ai.stigmer.billing.license.v1.License.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.billing.license.v1.License,
      ai.stigmer.billing.license.v1.License> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.billing.license.v1.License, ai.stigmer.billing.license.v1.License> getCreateMethod;
    if ((getCreateMethod = LicenseCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (LicenseCommandControllerGrpc.class) {
        if ((getCreateMethod = LicenseCommandControllerGrpc.getCreateMethod) == null) {
          LicenseCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.billing.license.v1.License, ai.stigmer.billing.license.v1.License>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.license.v1.License.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.billing.license.v1.License.getDefaultInstance()))
              .setSchemaDescriptor(new LicenseCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static LicenseCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<LicenseCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<LicenseCommandControllerStub>() {
        @java.lang.Override
        public LicenseCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new LicenseCommandControllerStub(channel, callOptions);
        }
      };
    return LicenseCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static LicenseCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<LicenseCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<LicenseCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public LicenseCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new LicenseCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return LicenseCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static LicenseCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<LicenseCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<LicenseCommandControllerBlockingStub>() {
        @java.lang.Override
        public LicenseCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new LicenseCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return LicenseCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static LicenseCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<LicenseCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<LicenseCommandControllerFutureStub>() {
        @java.lang.Override
        public LicenseCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new LicenseCommandControllerFutureStub(channel, callOptions);
        }
      };
    return LicenseCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * LicenseCommandController provides the write operations on licenses.
   * Issuing is the one write: the claims are immutable once signed, so there
   * is no update, and a renewal or a change of entitlements is a new License.
   * Issuing is a platform operator act on the static platform target. A
   * self-serve trial door, if one is offered, is a separate public entry the
   * issuer adds beside this controller; it is not this RPC relaxed.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license; the relation lands in
   * the authorization model with the entry that serves the kind. The
   * issuer signs with an Ed25519 key held in the platform's vault, distinct
   * from the runtime token-signing key, and records the ticket in the status.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Issue a license.
     * Builds the signed claims from the spec, signs them, and returns the
     * license with its ticket in the status. The spec is final: nothing about
     * an issued license changes afterwards.
     * </pre>
     */
    default void create(ai.stigmer.billing.license.v1.License request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.license.v1.License> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service LicenseCommandController.
   * <pre>
   * LicenseCommandController provides the write operations on licenses.
   * Issuing is the one write: the claims are immutable once signed, so there
   * is no update, and a renewal or a change of entitlements is a new License.
   * Issuing is a platform operator act on the static platform target. A
   * self-serve trial door, if one is offered, is a separate public entry the
   * issuer adds beside this controller; it is not this RPC relaxed.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license; the relation lands in
   * the authorization model with the entry that serves the kind. The
   * issuer signs with an Ed25519 key held in the platform's vault, distinct
   * from the runtime token-signing key, and records the ticket in the status.
   * </pre>
   */
  public static abstract class LicenseCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return LicenseCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service LicenseCommandController.
   * <pre>
   * LicenseCommandController provides the write operations on licenses.
   * Issuing is the one write: the claims are immutable once signed, so there
   * is no update, and a renewal or a change of entitlements is a new License.
   * Issuing is a platform operator act on the static platform target. A
   * self-serve trial door, if one is offered, is a separate public entry the
   * issuer adds beside this controller; it is not this RPC relaxed.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license; the relation lands in
   * the authorization model with the entry that serves the kind. The
   * issuer signs with an Ed25519 key held in the platform's vault, distinct
   * from the runtime token-signing key, and records the ticket in the status.
   * </pre>
   */
  public static final class LicenseCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<LicenseCommandControllerStub> {
    private LicenseCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected LicenseCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new LicenseCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Issue a license.
     * Builds the signed claims from the spec, signs them, and returns the
     * license with its ticket in the status. The spec is final: nothing about
     * an issued license changes afterwards.
     * </pre>
     */
    public void create(ai.stigmer.billing.license.v1.License request,
        io.grpc.stub.StreamObserver<ai.stigmer.billing.license.v1.License> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service LicenseCommandController.
   * <pre>
   * LicenseCommandController provides the write operations on licenses.
   * Issuing is the one write: the claims are immutable once signed, so there
   * is no update, and a renewal or a change of entitlements is a new License.
   * Issuing is a platform operator act on the static platform target. A
   * self-serve trial door, if one is offered, is a separate public entry the
   * issuer adds beside this controller; it is not this RPC relaxed.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license; the relation lands in
   * the authorization model with the entry that serves the kind. The
   * issuer signs with an Ed25519 key held in the platform's vault, distinct
   * from the runtime token-signing key, and records the ticket in the status.
   * </pre>
   */
  public static final class LicenseCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<LicenseCommandControllerBlockingV2Stub> {
    private LicenseCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected LicenseCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new LicenseCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Issue a license.
     * Builds the signed claims from the spec, signs them, and returns the
     * license with its ticket in the status. The spec is final: nothing about
     * an issued license changes afterwards.
     * </pre>
     */
    public ai.stigmer.billing.license.v1.License create(ai.stigmer.billing.license.v1.License request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service LicenseCommandController.
   * <pre>
   * LicenseCommandController provides the write operations on licenses.
   * Issuing is the one write: the claims are immutable once signed, so there
   * is no update, and a renewal or a change of entitlements is a new License.
   * Issuing is a platform operator act on the static platform target. A
   * self-serve trial door, if one is offered, is a separate public entry the
   * issuer adds beside this controller; it is not this RPC relaxed.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license; the relation lands in
   * the authorization model with the entry that serves the kind. The
   * issuer signs with an Ed25519 key held in the platform's vault, distinct
   * from the runtime token-signing key, and records the ticket in the status.
   * </pre>
   */
  public static final class LicenseCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<LicenseCommandControllerBlockingStub> {
    private LicenseCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected LicenseCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new LicenseCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Issue a license.
     * Builds the signed claims from the spec, signs them, and returns the
     * license with its ticket in the status. The spec is final: nothing about
     * an issued license changes afterwards.
     * </pre>
     */
    public ai.stigmer.billing.license.v1.License create(ai.stigmer.billing.license.v1.License request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service LicenseCommandController.
   * <pre>
   * LicenseCommandController provides the write operations on licenses.
   * Issuing is the one write: the claims are immutable once signed, so there
   * is no update, and a renewal or a change of entitlements is a new License.
   * Issuing is a platform operator act on the static platform target. A
   * self-serve trial door, if one is offered, is a separate public entry the
   * issuer adds beside this controller; it is not this RPC relaxed.
   * &#64;internal
   * Served by the cloud composition only (the kind is cloud_only). Authorizes
   * against platform:stigmer with can_issue_license; the relation lands in
   * the authorization model with the entry that serves the kind. The
   * issuer signs with an Ed25519 key held in the platform's vault, distinct
   * from the runtime token-signing key, and records the ticket in the status.
   * </pre>
   */
  public static final class LicenseCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<LicenseCommandControllerFutureStub> {
    private LicenseCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected LicenseCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new LicenseCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Issue a license.
     * Builds the signed claims from the spec, signs them, and returns the
     * license with its ticket in the status. The spec is final: nothing about
     * an issued license changes afterwards.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.billing.license.v1.License> create(
        ai.stigmer.billing.license.v1.License request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;

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
          serviceImpl.create((ai.stigmer.billing.license.v1.License) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.billing.license.v1.License>) responseObserver);
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
              ai.stigmer.billing.license.v1.License,
              ai.stigmer.billing.license.v1.License>(
                service, METHODID_CREATE)))
        .build();
  }

  private static abstract class LicenseCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    LicenseCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.billing.license.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("LicenseCommandController");
    }
  }

  private static final class LicenseCommandControllerFileDescriptorSupplier
      extends LicenseCommandControllerBaseDescriptorSupplier {
    LicenseCommandControllerFileDescriptorSupplier() {}
  }

  private static final class LicenseCommandControllerMethodDescriptorSupplier
      extends LicenseCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    LicenseCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (LicenseCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new LicenseCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .build();
        }
      }
    }
    return result;
  }
}
