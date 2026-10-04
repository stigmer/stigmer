package ai.stigmer.tenancy.organization.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * OrganizationCommandController handles write operations for organizations.
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.tenancy.organization.v1.Organization> getRenameMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rename",
      requestType = ai.stigmer.commons.apiresource.RenameInput.class,
      responseType = ai.stigmer.tenancy.organization.v1.Organization.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.tenancy.organization.v1.Organization> getRenameMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.tenancy.organization.v1.Organization> getRenameMethod;
    if ((getRenameMethod = OrganizationCommandControllerGrpc.getRenameMethod) == null) {
      synchronized (OrganizationCommandControllerGrpc.class) {
        if ((getRenameMethod = OrganizationCommandControllerGrpc.getRenameMethod) == null) {
          OrganizationCommandControllerGrpc.getRenameMethod = getRenameMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.tenancy.organization.v1.Organization>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rename"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.RenameInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.tenancy.organization.v1.Organization.getDefaultInstance()))
              .setSchemaDescriptor(new OrganizationCommandControllerMethodDescriptorSupplier("rename"))
              .build();
        }
      }
    }
    return getRenameMethod;
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
   * OrganizationCommandController handles write operations for organizations.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update an organization.
     * Its create arm is refused as create is, ORGANIZATION_LIMIT_REACHED
     * included.
     * </pre>
     */
    default void apply(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create an organization.
     * The server mints the organization's id (org_&lt;ulid&gt;); metadata.org must be
     * empty, because an organization belongs to no organization (one that names
     * the organization itself, by its own id or slug, is cleared). A slug held by
     * another organization is refused with ALREADY_EXISTS; a slug another
     * organization was renamed away from, and which still resolves to it, is
     * refused with ALREADY_EXISTS carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ORGANIZATION_SLUG_RESERVED — another organization held the slug
     *     until a recent rename, and it still resolves there; or an
     *     organization from an earlier release was filed under it, which keeps
     *     it reserved for good, deleted or not. Metadata: slug.
     * On Stigmer Cloud, creating a platform-managed organization is a plan
     * feature of its integrator. An integrator whose plan lacks it is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the integrator organization's plan does not
     *     include the feature. Metadata: feature ("managed_organizations"),
     *     org (the integrator organization).
     * A server composed to hold a limited number of organizations (the
     * open-source edition holds one, which it makes the first time it
     * starts) refuses a create once it holds that many, with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), before anything is written:
     *   - ORGANIZATION_LIMIT_REACHED — the server holds as many organizations
     *     as it is composed to. Metadata: limit.
     * </pre>
     */
    default void create(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing organization.
     * The slug is not changed by an update (it is ignored, as for every
     * kind); rename changes it.
     * </pre>
     */
    default void update(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rename an organization: change its slug, the name people type.
     * Nothing the organization owns moves, because every resource names it by
     * id. The old slug keeps resolving to the organization for 30 days, during
     * which no other organization can take it and this one can take it back;
     * then it is released. A slug another organization holds is refused with
     * ALREADY_EXISTS, and one another organization was recently renamed away
     * from with ORGANIZATION_SLUG_RESERVED (see create).
     * </pre>
     */
    default void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRenameMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete an organization. Its slug is released once the organization is
     * gone: a later organization may take it, and sees nothing the deleted one
     * owned, because every resource names its organization by id.
     * A server that holds one organization (GetServerInfoOutput.single_org's
     * composition) refuses to delete it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - ORGANIZATION_IS_SINGLE — the server's only organization cannot be
     *     deleted. Metadata: org.
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
   * OrganizationCommandController handles write operations for organizations.
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
   * OrganizationCommandController handles write operations for organizations.
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
     * Its create arm is refused as create is, ORGANIZATION_LIMIT_REACHED
     * included.
     * </pre>
     */
    public void apply(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create an organization.
     * The server mints the organization's id (org_&lt;ulid&gt;); metadata.org must be
     * empty, because an organization belongs to no organization (one that names
     * the organization itself, by its own id or slug, is cleared). A slug held by
     * another organization is refused with ALREADY_EXISTS; a slug another
     * organization was renamed away from, and which still resolves to it, is
     * refused with ALREADY_EXISTS carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ORGANIZATION_SLUG_RESERVED — another organization held the slug
     *     until a recent rename, and it still resolves there; or an
     *     organization from an earlier release was filed under it, which keeps
     *     it reserved for good, deleted or not. Metadata: slug.
     * On Stigmer Cloud, creating a platform-managed organization is a plan
     * feature of its integrator. An integrator whose plan lacks it is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the integrator organization's plan does not
     *     include the feature. Metadata: feature ("managed_organizations"),
     *     org (the integrator organization).
     * A server composed to hold a limited number of organizations (the
     * open-source edition holds one, which it makes the first time it
     * starts) refuses a create once it holds that many, with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), before anything is written:
     *   - ORGANIZATION_LIMIT_REACHED — the server holds as many organizations
     *     as it is composed to. Metadata: limit.
     * </pre>
     */
    public void create(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing organization.
     * The slug is not changed by an update (it is ignored, as for every
     * kind); rename changes it.
     * </pre>
     */
    public void update(ai.stigmer.tenancy.organization.v1.Organization request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rename an organization: change its slug, the name people type.
     * Nothing the organization owns moves, because every resource names it by
     * id. The old slug keeps resolving to the organization for 30 days, during
     * which no other organization can take it and this one can take it back;
     * then it is released. A slug another organization holds is refused with
     * ALREADY_EXISTS, and one another organization was recently renamed away
     * from with ORGANIZATION_SLUG_RESERVED (see create).
     * </pre>
     */
    public void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.tenancy.organization.v1.Organization> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete an organization. Its slug is released once the organization is
     * gone: a later organization may take it, and sees nothing the deleted one
     * owned, because every resource names its organization by id.
     * A server that holds one organization (GetServerInfoOutput.single_org's
     * composition) refuses to delete it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - ORGANIZATION_IS_SINGLE — the server's only organization cannot be
     *     deleted. Metadata: org.
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
   * OrganizationCommandController handles write operations for organizations.
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
     * Its create arm is refused as create is, ORGANIZATION_LIMIT_REACHED
     * included.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization apply(ai.stigmer.tenancy.organization.v1.Organization request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an organization.
     * The server mints the organization's id (org_&lt;ulid&gt;); metadata.org must be
     * empty, because an organization belongs to no organization (one that names
     * the organization itself, by its own id or slug, is cleared). A slug held by
     * another organization is refused with ALREADY_EXISTS; a slug another
     * organization was renamed away from, and which still resolves to it, is
     * refused with ALREADY_EXISTS carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ORGANIZATION_SLUG_RESERVED — another organization held the slug
     *     until a recent rename, and it still resolves there; or an
     *     organization from an earlier release was filed under it, which keeps
     *     it reserved for good, deleted or not. Metadata: slug.
     * On Stigmer Cloud, creating a platform-managed organization is a plan
     * feature of its integrator. An integrator whose plan lacks it is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the integrator organization's plan does not
     *     include the feature. Metadata: feature ("managed_organizations"),
     *     org (the integrator organization).
     * A server composed to hold a limited number of organizations (the
     * open-source edition holds one, which it makes the first time it
     * starts) refuses a create once it holds that many, with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), before anything is written:
     *   - ORGANIZATION_LIMIT_REACHED — the server holds as many organizations
     *     as it is composed to. Metadata: limit.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization create(ai.stigmer.tenancy.organization.v1.Organization request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing organization.
     * The slug is not changed by an update (it is ignored, as for every
     * kind); rename changes it.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization update(ai.stigmer.tenancy.organization.v1.Organization request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an organization: change its slug, the name people type.
     * Nothing the organization owns moves, because every resource names it by
     * id. The old slug keeps resolving to the organization for 30 days, during
     * which no other organization can take it and this one can take it back;
     * then it is released. A slug another organization holds is refused with
     * ALREADY_EXISTS, and one another organization was recently renamed away
     * from with ORGANIZATION_SLUG_RESERVED (see create).
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization rename(ai.stigmer.commons.apiresource.RenameInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an organization. Its slug is released once the organization is
     * gone: a later organization may take it, and sees nothing the deleted one
     * owned, because every resource names its organization by id.
     * A server that holds one organization (GetServerInfoOutput.single_org's
     * composition) refuses to delete it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - ORGANIZATION_IS_SINGLE — the server's only organization cannot be
     *     deleted. Metadata: org.
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
   * OrganizationCommandController handles write operations for organizations.
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
     * Its create arm is refused as create is, ORGANIZATION_LIMIT_REACHED
     * included.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization apply(ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create an organization.
     * The server mints the organization's id (org_&lt;ulid&gt;); metadata.org must be
     * empty, because an organization belongs to no organization (one that names
     * the organization itself, by its own id or slug, is cleared). A slug held by
     * another organization is refused with ALREADY_EXISTS; a slug another
     * organization was renamed away from, and which still resolves to it, is
     * refused with ALREADY_EXISTS carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ORGANIZATION_SLUG_RESERVED — another organization held the slug
     *     until a recent rename, and it still resolves there; or an
     *     organization from an earlier release was filed under it, which keeps
     *     it reserved for good, deleted or not. Metadata: slug.
     * On Stigmer Cloud, creating a platform-managed organization is a plan
     * feature of its integrator. An integrator whose plan lacks it is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the integrator organization's plan does not
     *     include the feature. Metadata: feature ("managed_organizations"),
     *     org (the integrator organization).
     * A server composed to hold a limited number of organizations (the
     * open-source edition holds one, which it makes the first time it
     * starts) refuses a create once it holds that many, with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), before anything is written:
     *   - ORGANIZATION_LIMIT_REACHED — the server holds as many organizations
     *     as it is composed to. Metadata: limit.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization create(ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing organization.
     * The slug is not changed by an update (it is ignored, as for every
     * kind); rename changes it.
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization update(ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename an organization: change its slug, the name people type.
     * Nothing the organization owns moves, because every resource names it by
     * id. The old slug keeps resolving to the organization for 30 days, during
     * which no other organization can take it and this one can take it back;
     * then it is released. A slug another organization holds is refused with
     * ALREADY_EXISTS, and one another organization was recently renamed away
     * from with ORGANIZATION_SLUG_RESERVED (see create).
     * </pre>
     */
    public ai.stigmer.tenancy.organization.v1.Organization rename(ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete an organization. Its slug is released once the organization is
     * gone: a later organization may take it, and sees nothing the deleted one
     * owned, because every resource names its organization by id.
     * A server that holds one organization (GetServerInfoOutput.single_org's
     * composition) refuses to delete it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - ORGANIZATION_IS_SINGLE — the server's only organization cannot be
     *     deleted. Metadata: org.
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
   * OrganizationCommandController handles write operations for organizations.
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
     * Its create arm is refused as create is, ORGANIZATION_LIMIT_REACHED
     * included.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> apply(
        ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create an organization.
     * The server mints the organization's id (org_&lt;ulid&gt;); metadata.org must be
     * empty, because an organization belongs to no organization (one that names
     * the organization itself, by its own id or slug, is cleared). A slug held by
     * another organization is refused with ALREADY_EXISTS; a slug another
     * organization was renamed away from, and which still resolves to it, is
     * refused with ALREADY_EXISTS carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ORGANIZATION_SLUG_RESERVED — another organization held the slug
     *     until a recent rename, and it still resolves there; or an
     *     organization from an earlier release was filed under it, which keeps
     *     it reserved for good, deleted or not. Metadata: slug.
     * On Stigmer Cloud, creating a platform-managed organization is a plan
     * feature of its integrator. An integrator whose plan lacks it is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"):
     *   - PLAN_UPGRADE_REQUIRED — the integrator organization's plan does not
     *     include the feature. Metadata: feature ("managed_organizations"),
     *     org (the integrator organization).
     * A server composed to hold a limited number of organizations (the
     * open-source edition holds one, which it makes the first time it
     * starts) refuses a create once it holds that many, with
     * FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), before anything is written:
     *   - ORGANIZATION_LIMIT_REACHED — the server holds as many organizations
     *     as it is composed to. Metadata: limit.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> create(
        ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing organization.
     * The slug is not changed by an update (it is ignored, as for every
     * kind); rename changes it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> update(
        ai.stigmer.tenancy.organization.v1.Organization request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rename an organization: change its slug, the name people type.
     * Nothing the organization owns moves, because every resource names it by
     * id. The old slug keeps resolving to the organization for 30 days, during
     * which no other organization can take it and this one can take it back;
     * then it is released. A slug another organization holds is refused with
     * ALREADY_EXISTS, and one another organization was recently renamed away
     * from with ORGANIZATION_SLUG_RESERVED (see create).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.tenancy.organization.v1.Organization> rename(
        ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete an organization. Its slug is released once the organization is
     * gone: a later organization may take it, and sees nothing the deleted one
     * owned, because every resource names its organization by id.
     * A server that holds one organization (GetServerInfoOutput.single_org's
     * composition) refuses to delete it with FAILED_PRECONDITION carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"), before anything is
     * written:
     *   - ORGANIZATION_IS_SINGLE — the server's only organization cannot be
     *     deleted. Metadata: org.
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
  private static final int METHODID_RENAME = 3;
  private static final int METHODID_DELETE = 4;

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
        case METHODID_RENAME:
          serviceImpl.rename((ai.stigmer.commons.apiresource.RenameInput) request,
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
          getRenameMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.RenameInput,
              ai.stigmer.tenancy.organization.v1.Organization>(
                service, METHODID_RENAME)))
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
              .addMethod(getRenameMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
