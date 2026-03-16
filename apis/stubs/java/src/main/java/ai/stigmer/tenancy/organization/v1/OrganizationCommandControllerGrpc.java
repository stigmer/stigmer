package ai.stigmer.tenancy.organization.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * OrganizationCommandController provides write operations for organizations
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class OrganizationCommandControllerGrpc {

  private OrganizationCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.tenancy.organization.v1.OrganizationCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.Organization,
      ai.stigmer.tenancy.organization.v1.Organization> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.tenancy.organization.v1.Organization.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organization.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.Organization,
      ai.stigmer.tenancy.organization.v1.Organization> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.Organization, ai.stigmer.tenancy.organization.v1.Organization> getApplyMethod;
    if ((getApplyMethod = OrganizationCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (OrganizationCommandControllerGrpc.class) {
        if ((getApplyMethod = OrganizationCommandControllerGrpc.getApplyMethod) == null) {
          OrganizationCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.organization.v1.Organization, ai.stigmer.tenancy.organization.v1.Organization>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.Organization,
      ai.stigmer.tenancy.organization.v1.Organization> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.tenancy.organization.v1.Organization.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organization.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.Organization,
      ai.stigmer.tenancy.organization.v1.Organization> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.Organization, ai.stigmer.tenancy.organization.v1.Organization> getCreateMethod;
    if ((getCreateMethod = OrganizationCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (OrganizationCommandControllerGrpc.class) {
        if ((getCreateMethod = OrganizationCommandControllerGrpc.getCreateMethod) == null) {
          OrganizationCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.organization.v1.Organization, ai.stigmer.tenancy.organization.v1.Organization>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.Organization,
      ai.stigmer.tenancy.organization.v1.Organization> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.tenancy.organization.v1.Organization.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organization.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.Organization,
      ai.stigmer.tenancy.organization.v1.Organization> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.Organization, ai.stigmer.tenancy.organization.v1.Organization> getUpdateMethod;
    if ((getUpdateMethod = OrganizationCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (OrganizationCommandControllerGrpc.class) {
        if ((getUpdateMethod = OrganizationCommandControllerGrpc.getUpdateMethod) == null) {
          OrganizationCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.organization.v1.Organization, ai.stigmer.tenancy.organization.v1.Organization>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationId,
      ai.stigmer.tenancy.organization.v1.Organization> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.tenancy.organization.v1.OrganizationId.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organization.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationId,
      ai.stigmer.tenancy.organization.v1.Organization> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationId, ai.stigmer.tenancy.organization.v1.Organization> getDeleteMethod;
    if ((getDeleteMethod = OrganizationCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (OrganizationCommandControllerGrpc.class) {
        if ((getDeleteMethod = OrganizationCommandControllerGrpc.getDeleteMethod) == null) {
          OrganizationCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.organization.v1.OrganizationId, ai.stigmer.tenancy.organization.v1.Organization>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.OrganizationId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static OrganizationCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OrganizationCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OrganizationCommandControllerStub>() {
        @java.lang.Override
        public OrganizationCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OrganizationCommandControllerStub(channel, callOptions);
        }
      };
    return OrganizationCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static OrganizationCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OrganizationCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OrganizationCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public OrganizationCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OrganizationCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return OrganizationCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static OrganizationCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OrganizationCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OrganizationCommandControllerBlockingStub>() {
        @java.lang.Override
        public OrganizationCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OrganizationCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return OrganizationCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static OrganizationCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OrganizationCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OrganizationCommandControllerFutureStub>() {
        @java.lang.Override
        public OrganizationCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OrganizationCommandControllerFutureStub(channel, callOptions);
        }
      };
    return OrganizationCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * OrganizationCommandController provides write operations for organizations
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an organization.
     * The authorization and state-operation are determined depending on whether the organization
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a new organization
     * No authorization required - any authenticated user can create an organization
     * The creator automatically becomes the owner of the organization
     * </pre>
     */
    default void create(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing organization
     * Requires: Organization admin permission (can_edit)
     * </pre>
     */
    default void update(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an organization
     * Requires: Organization owner permission (can_delete)
     * Note: This will cascade delete all resources under the organization
     * </pre>
     */
    default void delete(ai.stigmer.tenancy.organization.v1.OrganizationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service OrganizationCommandController.
   * <pre>
   * OrganizationCommandController provides write operations for organizations
   * </pre>
   */
  public static abstract class OrganizationCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return OrganizationCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service OrganizationCommandController.
   * <pre>
   * OrganizationCommandController provides write operations for organizations
   * </pre>
   */
  public static final class OrganizationCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<OrganizationCommandControllerStub> {
    private OrganizationCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OrganizationCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OrganizationCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an organization.
     * The authorization and state-operation are determined depending on whether the organization
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a new organization
     * No authorization required - any authenticated user can create an organization
     * The creator automatically becomes the owner of the organization
     * </pre>
     */
    public void create(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing organization
     * Requires: Organization admin permission (can_edit)
     * </pre>
     */
    public void update(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an organization
     * Requires: Organization owner permission (can_delete)
     * Note: This will cascade delete all resources under the organization
     * </pre>
     */
    public void delete(ai.stigmer.tenancy.organization.v1.OrganizationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service OrganizationCommandController.
   * <pre>
   * OrganizationCommandController provides write operations for organizations
   * </pre>
   */
  public static final class OrganizationCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<OrganizationCommandControllerBlockingV2Stub> {
    private OrganizationCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OrganizationCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OrganizationCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an organization.
     * The authorization and state-operation are determined depending on whether the organization
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization apply(ai.stigmer.tenancy.organization.v1.Organization request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new organization
     * No authorization required - any authenticated user can create an organization
     * The creator automatically becomes the owner of the organization
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization create(ai.stigmer.tenancy.organization.v1.Organization request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing organization
     * Requires: Organization admin permission (can_edit)
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization update(ai.stigmer.tenancy.organization.v1.Organization request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an organization
     * Requires: Organization owner permission (can_delete)
     * Note: This will cascade delete all resources under the organization
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization delete(ai.stigmer.tenancy.organization.v1.OrganizationId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service OrganizationCommandController.
   * <pre>
   * OrganizationCommandController provides write operations for organizations
   * </pre>
   */
  public static final class OrganizationCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<OrganizationCommandControllerBlockingStub> {
    private OrganizationCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OrganizationCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OrganizationCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an organization.
     * The authorization and state-operation are determined depending on whether the organization
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization apply(ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a new organization
     * No authorization required - any authenticated user can create an organization
     * The creator automatically becomes the owner of the organization
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization create(ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing organization
     * Requires: Organization admin permission (can_edit)
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization update(ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an organization
     * Requires: Organization owner permission (can_delete)
     * Note: This will cascade delete all resources under the organization
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization delete(ai.stigmer.tenancy.organization.v1.OrganizationId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service OrganizationCommandController.
   * <pre>
   * OrganizationCommandController provides write operations for organizations
   * </pre>
   */
  public static final class OrganizationCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<OrganizationCommandControllerFutureStub> {
    private OrganizationCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OrganizationCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OrganizationCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update an organization.
     * The authorization and state-operation are determined depending on whether the organization
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> apply(
        ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a new organization
     * No authorization required - any authenticated user can create an organization
     * The creator automatically becomes the owner of the organization
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> create(
        ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing organization
     * Requires: Organization admin permission (can_edit)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> update(
        ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an organization
     * Requires: Organization owner permission (can_delete)
     * Note: This will cascade delete all resources under the organization
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> delete(
        ai.stigmer.tenancy.organization.v1.OrganizationId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;

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
          serviceImpl.apply((ai.stigmer.tenancy.organization.v1.Organization) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.tenancy.organization.v1.Organization) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.tenancy.organization.v1.Organization) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.tenancy.organization.v1.OrganizationId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization>) responseObserver);
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
              ai.stigmer.tenancy.organization.v1.Organization,
              ai.stigmer.tenancy.organization.v1.Organization>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.organization.v1.Organization,
              ai.stigmer.tenancy.organization.v1.Organization>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.organization.v1.Organization,
              ai.stigmer.tenancy.organization.v1.Organization>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.organization.v1.OrganizationId,
              ai.stigmer.tenancy.organization.v1.Organization>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class OrganizationCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    OrganizationCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.tenancy.organization.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("OrganizationCommandController");
    }
  }

  private static final class OrganizationCommandControllerFileDescriptorSupplier
      extends OrganizationCommandControllerBaseDescriptorSupplier {
    OrganizationCommandControllerFileDescriptorSupplier() {}
  }

  private static final class OrganizationCommandControllerMethodDescriptorSupplier
      extends OrganizationCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    OrganizationCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (OrganizationCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new OrganizationCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
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
