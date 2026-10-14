package ai.stigmer.tenancy.organization.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * OrganizationQueryController handles read operations for organizations.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class OrganizationQueryControllerGrpc {

  private OrganizationQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.tenancy.organization.v1.OrganizationQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationId,
      ai.stigmer.tenancy.organization.v1.Organization> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.tenancy.organization.v1.OrganizationId.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organization.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationId,
      ai.stigmer.tenancy.organization.v1.Organization> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationId, ai.stigmer.tenancy.organization.v1.Organization> getGetMethod;
    if ((getGetMethod = OrganizationQueryControllerGrpc.getGetMethod) == null) {
      synchronized (OrganizationQueryControllerGrpc.class) {
        if ((getGetMethod = OrganizationQueryControllerGrpc.getGetMethod) == null) {
          OrganizationQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.organization.v1.OrganizationId, ai.stigmer.tenancy.organization.v1.Organization>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.OrganizationId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput,
      ai.stigmer.tenancy.organization.v1.Organizations> getListMineMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listMine",
      requestType = ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organizations.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput,
      ai.stigmer.tenancy.organization.v1.Organizations> getListMineMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput, ai.stigmer.tenancy.organization.v1.Organizations> getListMineMethod;
    if ((getListMineMethod = OrganizationQueryControllerGrpc.getListMineMethod) == null) {
      synchronized (OrganizationQueryControllerGrpc.class) {
        if ((getListMineMethod = OrganizationQueryControllerGrpc.getListMineMethod) == null) {
          OrganizationQueryControllerGrpc.getListMineMethod = getListMineMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput, ai.stigmer.tenancy.organization.v1.Organizations>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listMine"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organizations.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationQueryControllerMethodDescriptorSupplier("listMine"))
              .build();
        }
      }
    }
    return getListMineMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup,
      ai.stigmer.tenancy.organization.v1.Organization> getGetByExternalIdMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByExternalId",
      requestType = ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organization.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup,
      ai.stigmer.tenancy.organization.v1.Organization> getGetByExternalIdMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup, ai.stigmer.tenancy.organization.v1.Organization> getGetByExternalIdMethod;
    if ((getGetByExternalIdMethod = OrganizationQueryControllerGrpc.getGetByExternalIdMethod) == null) {
      synchronized (OrganizationQueryControllerGrpc.class) {
        if ((getGetByExternalIdMethod = OrganizationQueryControllerGrpc.getGetByExternalIdMethod) == null) {
          OrganizationQueryControllerGrpc.getGetByExternalIdMethod = getGetByExternalIdMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup, ai.stigmer.tenancy.organization.v1.Organization>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByExternalId"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationQueryControllerMethodDescriptorSupplier("getByExternalId"))
              .build();
        }
      }
    }
    return getGetByExternalIdMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.ListChildOrgsInput,
      ai.stigmer.tenancy.organization.v1.ChildOrgList> getListChildOrgsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listChildOrgs",
      requestType = ai.stigmer.tenancy.organization.v1.ListChildOrgsInput.class,
      responseType = ai.stigmer.tenancy.organization.v1.ChildOrgList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.ListChildOrgsInput,
      ai.stigmer.tenancy.organization.v1.ChildOrgList> getListChildOrgsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.ListChildOrgsInput, ai.stigmer.tenancy.organization.v1.ChildOrgList> getListChildOrgsMethod;
    if ((getListChildOrgsMethod = OrganizationQueryControllerGrpc.getListChildOrgsMethod) == null) {
      synchronized (OrganizationQueryControllerGrpc.class) {
        if ((getListChildOrgsMethod = OrganizationQueryControllerGrpc.getListChildOrgsMethod) == null) {
          OrganizationQueryControllerGrpc.getListChildOrgsMethod = getListChildOrgsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.organization.v1.ListChildOrgsInput, ai.stigmer.tenancy.organization.v1.ChildOrgList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listChildOrgs"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.ListChildOrgsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.ChildOrgList.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationQueryControllerMethodDescriptorSupplier("listChildOrgs"))
              .build();
        }
      }
    }
    return getListChildOrgsMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static OrganizationQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OrganizationQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OrganizationQueryControllerStub>() {
        @java.lang.Override
        public OrganizationQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OrganizationQueryControllerStub(channel, callOptions);
        }
      };
    return OrganizationQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static OrganizationQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OrganizationQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OrganizationQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public OrganizationQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OrganizationQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return OrganizationQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static OrganizationQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OrganizationQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OrganizationQueryControllerBlockingStub>() {
        @java.lang.Override
        public OrganizationQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OrganizationQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return OrganizationQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static OrganizationQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<OrganizationQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<OrganizationQueryControllerFutureStub>() {
        @java.lang.Override
        public OrganizationQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new OrganizationQueryControllerFutureStub(channel, callOptions);
        }
      };
    return OrganizationQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * OrganizationQueryController handles read operations for organizations.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an organization by ID.
     * </pre>
     */
    default void get(ai.stigmer.tenancy.organization.v1.OrganizationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the organizations the authenticated caller is a member of.
     * Returns only organizations the caller has access to.
     * </pre>
     */
    default void listMine(ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organizations> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMineMethod(), responseObserver);
    }

    /**
     * <pre>
     * Find a child organization by the identifier its parent keeps for it
     * (external_id). An organization that is not a child of parent_org, or no
     * child with that identifier, answers NotFound.
     * </pre>
     */
    default void getByExternalId(ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByExternalIdMethod(), responseObserver);
    }

    /**
     * <pre>
     * List an organization's child organizations, newest first.
     * </pre>
     */
    default void listChildOrgs(ai.stigmer.tenancy.organization.v1.ListChildOrgsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.ChildOrgList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListChildOrgsMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service OrganizationQueryController.
   * <pre>
   * OrganizationQueryController handles read operations for organizations.
   * </pre>
   */
  public static abstract class OrganizationQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return OrganizationQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service OrganizationQueryController.
   * <pre>
   * OrganizationQueryController handles read operations for organizations.
   * </pre>
   */
  public static final class OrganizationQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<OrganizationQueryControllerStub> {
    private OrganizationQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OrganizationQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OrganizationQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an organization by ID.
     * </pre>
     */
    public void get(ai.stigmer.tenancy.organization.v1.OrganizationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the organizations the authenticated caller is a member of.
     * Returns only organizations the caller has access to.
     * </pre>
     */
    public void listMine(ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organizations> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMineMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Find a child organization by the identifier its parent keeps for it
     * (external_id). An organization that is not a child of parent_org, or no
     * child with that identifier, answers NotFound.
     * </pre>
     */
    public void getByExternalId(ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByExternalIdMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List an organization's child organizations, newest first.
     * </pre>
     */
    public void listChildOrgs(ai.stigmer.tenancy.organization.v1.ListChildOrgsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.ChildOrgList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListChildOrgsMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service OrganizationQueryController.
   * <pre>
   * OrganizationQueryController handles read operations for organizations.
   * </pre>
   */
  public static final class OrganizationQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<OrganizationQueryControllerBlockingV2Stub> {
    private OrganizationQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OrganizationQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OrganizationQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an organization by ID.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization get(ai.stigmer.tenancy.organization.v1.OrganizationId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the organizations the authenticated caller is a member of.
     * Returns only organizations the caller has access to.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organizations listMine(ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Find a child organization by the identifier its parent keeps for it
     * (external_id). An organization that is not a child of parent_org, or no
     * child with that identifier, answers NotFound.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization getByExternalId(ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByExternalIdMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an organization's child organizations, newest first.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.ChildOrgList listChildOrgs(ai.stigmer.tenancy.organization.v1.ListChildOrgsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListChildOrgsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service OrganizationQueryController.
   * <pre>
   * OrganizationQueryController handles read operations for organizations.
   * </pre>
   */
  public static final class OrganizationQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<OrganizationQueryControllerBlockingStub> {
    private OrganizationQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OrganizationQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OrganizationQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an organization by ID.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization get(ai.stigmer.tenancy.organization.v1.OrganizationId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the organizations the authenticated caller is a member of.
     * Returns only organizations the caller has access to.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organizations listMine(ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Find a child organization by the identifier its parent keeps for it
     * (external_id). An organization that is not a child of parent_org, or no
     * child with that identifier, answers NotFound.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization getByExternalId(ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByExternalIdMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an organization's child organizations, newest first.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.ChildOrgList listChildOrgs(ai.stigmer.tenancy.organization.v1.ListChildOrgsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListChildOrgsMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service OrganizationQueryController.
   * <pre>
   * OrganizationQueryController handles read operations for organizations.
   * </pre>
   */
  public static final class OrganizationQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<OrganizationQueryControllerFutureStub> {
    private OrganizationQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected OrganizationQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new OrganizationQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an organization by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> get(
        ai.stigmer.tenancy.organization.v1.OrganizationId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the organizations the authenticated caller is a member of.
     * Returns only organizations the caller has access to.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organizations> listMine(
        ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMineMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Find a child organization by the identifier its parent keeps for it
     * (external_id). An organization that is not a child of parent_org, or no
     * child with that identifier, answers NotFound.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> getByExternalId(
        ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByExternalIdMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List an organization's child organizations, newest first.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.ChildOrgList> listChildOrgs(
        ai.stigmer.tenancy.organization.v1.ListChildOrgsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListChildOrgsMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST_MINE = 1;
  private static final int METHODID_GET_BY_EXTERNAL_ID = 2;
  private static final int METHODID_LIST_CHILD_ORGS = 3;

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
          serviceImpl.get((ai.stigmer.tenancy.organization.v1.OrganizationId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization>) responseObserver);
          break;
        case METHODID_LIST_MINE:
          serviceImpl.listMine((ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organizations>) responseObserver);
          break;
        case METHODID_GET_BY_EXTERNAL_ID:
          serviceImpl.getByExternalId((ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization>) responseObserver);
          break;
        case METHODID_LIST_CHILD_ORGS:
          serviceImpl.listChildOrgs((ai.stigmer.tenancy.organization.v1.ListChildOrgsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.ChildOrgList>) responseObserver);
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
              ai.stigmer.tenancy.organization.v1.OrganizationId,
              ai.stigmer.tenancy.organization.v1.Organization>(
                service, METHODID_GET)))
        .addMethod(
          getListMineMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.organization.v1.ListMyOrganizationsInput,
              ai.stigmer.tenancy.organization.v1.Organizations>(
                service, METHODID_LIST_MINE)))
        .addMethod(
          getGetByExternalIdMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup,
              ai.stigmer.tenancy.organization.v1.Organization>(
                service, METHODID_GET_BY_EXTERNAL_ID)))
        .addMethod(
          getListChildOrgsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.organization.v1.ListChildOrgsInput,
              ai.stigmer.tenancy.organization.v1.ChildOrgList>(
                service, METHODID_LIST_CHILD_ORGS)))
        .build();
  }

  private static abstract class OrganizationQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    OrganizationQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.tenancy.organization.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("OrganizationQueryController");
    }
  }

  private static final class OrganizationQueryControllerFileDescriptorSupplier
      extends OrganizationQueryControllerBaseDescriptorSupplier {
    OrganizationQueryControllerFileDescriptorSupplier() {}
  }

  private static final class OrganizationQueryControllerMethodDescriptorSupplier
      extends OrganizationQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    OrganizationQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (OrganizationQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new OrganizationQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMineMethod())
              .addMethod(getGetByExternalIdMethod())
              .addMethod(getListChildOrgsMethod())
              .build();
        }
      }
    }
    return result;
  }
}
