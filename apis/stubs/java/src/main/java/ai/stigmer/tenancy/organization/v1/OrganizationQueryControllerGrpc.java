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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.FindApiResourcesRequest,
      ai.stigmer.tenancy.organization.v1.OrganizationList> getFindMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "find",
      requestType = ai.stigmer.commons.apiresource.FindApiResourcesRequest.class,
      responseType = ai.stigmer.tenancy.organization.v1.OrganizationList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.FindApiResourcesRequest,
      ai.stigmer.tenancy.organization.v1.OrganizationList> getFindMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.FindApiResourcesRequest, ai.stigmer.tenancy.organization.v1.OrganizationList> getFindMethod;
    if ((getFindMethod = OrganizationQueryControllerGrpc.getFindMethod) == null) {
      synchronized (OrganizationQueryControllerGrpc.class) {
        if ((getFindMethod = OrganizationQueryControllerGrpc.getFindMethod) == null) {
          OrganizationQueryControllerGrpc.getFindMethod = getFindMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.FindApiResourcesRequest, ai.stigmer.tenancy.organization.v1.OrganizationList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "find"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.FindApiResourcesRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.OrganizationList.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationQueryControllerMethodDescriptorSupplier("find"))
              .build();
        }
      }
    }
    return getFindMethod;
  }

  private static volatile io.grpc.MethodDescriptor<com.google.protobuf.Empty,
      ai.stigmer.tenancy.organization.v1.Organizations> getFindMyOrganizationsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "findMyOrganizations",
      requestType = com.google.protobuf.Empty.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organizations.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<com.google.protobuf.Empty,
      ai.stigmer.tenancy.organization.v1.Organizations> getFindMyOrganizationsMethod() {
    io.grpc.MethodDescriptor<com.google.protobuf.Empty, ai.stigmer.tenancy.organization.v1.Organizations> getFindMyOrganizationsMethod;
    if ((getFindMyOrganizationsMethod = OrganizationQueryControllerGrpc.getFindMyOrganizationsMethod) == null) {
      synchronized (OrganizationQueryControllerGrpc.class) {
        if ((getFindMyOrganizationsMethod = OrganizationQueryControllerGrpc.getFindMyOrganizationsMethod) == null) {
          OrganizationQueryControllerGrpc.getFindMyOrganizationsMethod = getFindMyOrganizationsMethod =
              io.grpc.MethodDescriptor.<com.google.protobuf.Empty, ai.stigmer.tenancy.organization.v1.Organizations>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "findMyOrganizations"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  com.google.protobuf.Empty.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organizations.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationQueryControllerMethodDescriptorSupplier("findMyOrganizations"))
              .build();
        }
      }
    }
    return getFindMyOrganizationsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup,
      ai.stigmer.tenancy.organization.v1.Organization> getGetByExternalOrgIdMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByExternalOrgId",
      requestType = ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organization.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup,
      ai.stigmer.tenancy.organization.v1.Organization> getGetByExternalOrgIdMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup, ai.stigmer.tenancy.organization.v1.Organization> getGetByExternalOrgIdMethod;
    if ((getGetByExternalOrgIdMethod = OrganizationQueryControllerGrpc.getGetByExternalOrgIdMethod) == null) {
      synchronized (OrganizationQueryControllerGrpc.class) {
        if ((getGetByExternalOrgIdMethod = OrganizationQueryControllerGrpc.getGetByExternalOrgIdMethod) == null) {
          OrganizationQueryControllerGrpc.getGetByExternalOrgIdMethod = getGetByExternalOrgIdMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup, ai.stigmer.tenancy.organization.v1.Organization>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByExternalOrgId"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationQueryControllerMethodDescriptorSupplier("getByExternalOrgId"))
              .build();
        }
      }
    }
    return getGetByExternalOrgIdMethod;
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
     * &#64;internal
     * Authorization: Requires can_view permission on the organization.
     * </pre>
     */
    default void get(ai.stigmer.tenancy.organization.v1.OrganizationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List organizations with pagination and filtering.
     * &#64;internal
     * Authorization: Requires platform admin permission. Administrative use only.
     * </pre>
     */
    default void find(ai.stigmer.commons.apiresource.FindApiResourcesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.OrganizationList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getFindMethod(), responseObserver);
    }

    /**
     * <pre>
     * Find organizations the authenticated user is a member of.
     * Returns only organizations the caller has access to.
     * &#64;internal
     * Authorization handled in handler via IAM Policy listAuthorizedResourceIds.
     * </pre>
     */
    default void findMyOrganizations(com.google.protobuf.Empty request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organizations> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getFindMyOrganizationsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Look up a platform-managed organization by its external platform coordinates.
     * Returns the Stigmer organization mapped to the given IdentityProvider + external org ID.
     * &#64;internal
     * Authorization: custom — checks can_view on the referenced IdentityProvider.
     * </pre>
     */
    default void getByExternalOrgId(ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByExternalOrgIdMethod(), responseObserver);
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
     * &#64;internal
     * Authorization: Requires can_view permission on the organization.
     * </pre>
     */
    public void get(ai.stigmer.tenancy.organization.v1.OrganizationId request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List organizations with pagination and filtering.
     * &#64;internal
     * Authorization: Requires platform admin permission. Administrative use only.
     * </pre>
     */
    public void find(ai.stigmer.commons.apiresource.FindApiResourcesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.OrganizationList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getFindMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Find organizations the authenticated user is a member of.
     * Returns only organizations the caller has access to.
     * &#64;internal
     * Authorization handled in handler via IAM Policy listAuthorizedResourceIds.
     * </pre>
     */
    public void findMyOrganizations(com.google.protobuf.Empty request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organizations> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getFindMyOrganizationsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Look up a platform-managed organization by its external platform coordinates.
     * Returns the Stigmer organization mapped to the given IdentityProvider + external org ID.
     * &#64;internal
     * Authorization: custom — checks can_view on the referenced IdentityProvider.
     * </pre>
     */
    public void getByExternalOrgId(ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByExternalOrgIdMethod(), getCallOptions()), request, responseObserver);
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
     * &#64;internal
     * Authorization: Requires can_view permission on the organization.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization get(ai.stigmer.tenancy.organization.v1.OrganizationId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List organizations with pagination and filtering.
     * &#64;internal
     * Authorization: Requires platform admin permission. Administrative use only.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.OrganizationList find(ai.stigmer.commons.apiresource.FindApiResourcesRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getFindMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Find organizations the authenticated user is a member of.
     * Returns only organizations the caller has access to.
     * &#64;internal
     * Authorization handled in handler via IAM Policy listAuthorizedResourceIds.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organizations findMyOrganizations(com.google.protobuf.Empty request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getFindMyOrganizationsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Look up a platform-managed organization by its external platform coordinates.
     * Returns the Stigmer organization mapped to the given IdentityProvider + external org ID.
     * &#64;internal
     * Authorization: custom — checks can_view on the referenced IdentityProvider.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization getByExternalOrgId(ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByExternalOrgIdMethod(), getCallOptions(), request);
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
     * &#64;internal
     * Authorization: Requires can_view permission on the organization.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization get(ai.stigmer.tenancy.organization.v1.OrganizationId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List organizations with pagination and filtering.
     * &#64;internal
     * Authorization: Requires platform admin permission. Administrative use only.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.OrganizationList find(ai.stigmer.commons.apiresource.FindApiResourcesRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getFindMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Find organizations the authenticated user is a member of.
     * Returns only organizations the caller has access to.
     * &#64;internal
     * Authorization handled in handler via IAM Policy listAuthorizedResourceIds.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organizations findMyOrganizations(com.google.protobuf.Empty request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getFindMyOrganizationsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Look up a platform-managed organization by its external platform coordinates.
     * Returns the Stigmer organization mapped to the given IdentityProvider + external org ID.
     * &#64;internal
     * Authorization: custom — checks can_view on the referenced IdentityProvider.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization getByExternalOrgId(ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByExternalOrgIdMethod(), getCallOptions(), request);
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
     * &#64;internal
     * Authorization: Requires can_view permission on the organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> get(
        ai.stigmer.tenancy.organization.v1.OrganizationId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List organizations with pagination and filtering.
     * &#64;internal
     * Authorization: Requires platform admin permission. Administrative use only.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.OrganizationList> find(
        ai.stigmer.commons.apiresource.FindApiResourcesRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getFindMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Find organizations the authenticated user is a member of.
     * Returns only organizations the caller has access to.
     * &#64;internal
     * Authorization handled in handler via IAM Policy listAuthorizedResourceIds.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organizations> findMyOrganizations(
        com.google.protobuf.Empty request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getFindMyOrganizationsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Look up a platform-managed organization by its external platform coordinates.
     * Returns the Stigmer organization mapped to the given IdentityProvider + external org ID.
     * &#64;internal
     * Authorization: custom — checks can_view on the referenced IdentityProvider.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> getByExternalOrgId(
        ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByExternalOrgIdMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_FIND = 1;
  private static final int METHODID_FIND_MY_ORGANIZATIONS = 2;
  private static final int METHODID_GET_BY_EXTERNAL_ORG_ID = 3;

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
        case METHODID_FIND:
          serviceImpl.find((ai.stigmer.commons.apiresource.FindApiResourcesRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.OrganizationList>) responseObserver);
          break;
        case METHODID_FIND_MY_ORGANIZATIONS:
          serviceImpl.findMyOrganizations((com.google.protobuf.Empty) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organizations>) responseObserver);
          break;
        case METHODID_GET_BY_EXTERNAL_ORG_ID:
          serviceImpl.getByExternalOrgId((ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup) request,
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
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.organization.v1.OrganizationId,
              ai.stigmer.tenancy.organization.v1.Organization>(
                service, METHODID_GET)))
        .addMethod(
          getFindMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.FindApiResourcesRequest,
              ai.stigmer.tenancy.organization.v1.OrganizationList>(
                service, METHODID_FIND)))
        .addMethod(
          getFindMyOrganizationsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              com.google.protobuf.Empty,
              ai.stigmer.tenancy.organization.v1.Organizations>(
                service, METHODID_FIND_MY_ORGANIZATIONS)))
        .addMethod(
          getGetByExternalOrgIdMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.tenancy.organization.v1.OrganizationExternalLookup,
              ai.stigmer.tenancy.organization.v1.Organization>(
                service, METHODID_GET_BY_EXTERNAL_ORG_ID)))
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
              .addMethod(getFindMethod())
              .addMethod(getFindMyOrganizationsMethod())
              .addMethod(getGetByExternalOrgIdMethod())
              .build();
        }
      }
    }
    return result;
  }
}
