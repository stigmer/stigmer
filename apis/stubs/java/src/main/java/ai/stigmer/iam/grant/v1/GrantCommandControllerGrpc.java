package ai.stigmer.iam.grant.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * Grant Command Controller
 * This service manages the lifecycle of grants in Stigmer. One grant is one
 * role given to one principal on one resource; who holds what on a resource
 * is the set of its grants. Each grant connects three elements:
 * - Principal: WHO gets access (user, team, etc.)
 * - Resource: WHAT is being accessed (any API resource)
 * - Relation: HOW they can access it (viewer, admin, user, etc.)
 * A grant is the record; the edition's authorizer enforces
 * it. The Enterprise and Cloud editions also mirror each grant to an
 * OpenFGA tuple for fine-grained checks.
 * Common Use Cases:
 * - Granting users access to organizations
 * - Setting up team-based access control
 * - Managing fine-grained permissions on any resource
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class GrantCommandControllerGrpc {

  private GrantCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.grant.v1.GrantCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantSpec,
      ai.stigmer.iam.grant.v1.Grant> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.grant.v1.GrantSpec.class,
      responseType = ai.stigmer.iam.grant.v1.Grant.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantSpec,
      ai.stigmer.iam.grant.v1.Grant> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantSpec, ai.stigmer.iam.grant.v1.Grant> getCreateMethod;
    if ((getCreateMethod = GrantCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (GrantCommandControllerGrpc.class) {
        if ((getCreateMethod = GrantCommandControllerGrpc.getCreateMethod) == null) {
          GrantCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.GrantSpec, ai.stigmer.iam.grant.v1.Grant>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.GrantSpec.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.Grant.getDefaultInstance()))
              .setSchemaDescriptor(new GrantCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantSpec,
      ai.stigmer.iam.grant.v1.Grant> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.iam.grant.v1.GrantSpec.class,
      responseType = ai.stigmer.iam.grant.v1.Grant.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantSpec,
      ai.stigmer.iam.grant.v1.Grant> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantSpec, ai.stigmer.iam.grant.v1.Grant> getDeleteMethod;
    if ((getDeleteMethod = GrantCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (GrantCommandControllerGrpc.class) {
        if ((getDeleteMethod = GrantCommandControllerGrpc.getDeleteMethod) == null) {
          GrantCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.GrantSpec, ai.stigmer.iam.grant.v1.Grant>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.GrantSpec.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.Grant.getDefaultInstance()))
              .setSchemaDescriptor(new GrantCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantSpec,
      ai.stigmer.iam.grant.v1.Grant> getBootstrapGrantMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "bootstrapGrant",
      requestType = ai.stigmer.iam.grant.v1.GrantSpec.class,
      responseType = ai.stigmer.iam.grant.v1.Grant.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantSpec,
      ai.stigmer.iam.grant.v1.Grant> getBootstrapGrantMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantSpec, ai.stigmer.iam.grant.v1.Grant> getBootstrapGrantMethod;
    if ((getBootstrapGrantMethod = GrantCommandControllerGrpc.getBootstrapGrantMethod) == null) {
      synchronized (GrantCommandControllerGrpc.class) {
        if ((getBootstrapGrantMethod = GrantCommandControllerGrpc.getBootstrapGrantMethod) == null) {
          GrantCommandControllerGrpc.getBootstrapGrantMethod = getBootstrapGrantMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.GrantSpec, ai.stigmer.iam.grant.v1.Grant>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "bootstrapGrant"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.GrantSpec.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.Grant.getDefaultInstance()))
              .setSchemaDescriptor(new GrantCommandControllerMethodDescriptorSupplier("bootstrapGrant"))
              .build();
        }
      }
    }
    return getBootstrapGrantMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ApiResourceRef,
      com.google.protobuf.Empty> getCleanupResourceGrantsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cleanupResourceGrants",
      requestType = ai.stigmer.iam.grant.v1.ApiResourceRef.class,
      responseType = com.google.protobuf.Empty.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ApiResourceRef,
      com.google.protobuf.Empty> getCleanupResourceGrantsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ApiResourceRef, com.google.protobuf.Empty> getCleanupResourceGrantsMethod;
    if ((getCleanupResourceGrantsMethod = GrantCommandControllerGrpc.getCleanupResourceGrantsMethod) == null) {
      synchronized (GrantCommandControllerGrpc.class) {
        if ((getCleanupResourceGrantsMethod = GrantCommandControllerGrpc.getCleanupResourceGrantsMethod) == null) {
          GrantCommandControllerGrpc.getCleanupResourceGrantsMethod = getCleanupResourceGrantsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.ApiResourceRef, com.google.protobuf.Empty>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cleanupResourceGrants"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.ApiResourceRef.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  com.google.protobuf.Empty.getDefaultInstance()))
              .setSchemaDescriptor(new GrantCommandControllerMethodDescriptorSupplier("cleanupResourceGrants"))
              .build();
        }
      }
    }
    return getCleanupResourceGrantsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.RevokeOrgAccessInput,
      com.google.protobuf.Empty> getRevokeOrgAccessMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "revokeOrgAccess",
      requestType = ai.stigmer.iam.grant.v1.RevokeOrgAccessInput.class,
      responseType = com.google.protobuf.Empty.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.RevokeOrgAccessInput,
      com.google.protobuf.Empty> getRevokeOrgAccessMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.RevokeOrgAccessInput, com.google.protobuf.Empty> getRevokeOrgAccessMethod;
    if ((getRevokeOrgAccessMethod = GrantCommandControllerGrpc.getRevokeOrgAccessMethod) == null) {
      synchronized (GrantCommandControllerGrpc.class) {
        if ((getRevokeOrgAccessMethod = GrantCommandControllerGrpc.getRevokeOrgAccessMethod) == null) {
          GrantCommandControllerGrpc.getRevokeOrgAccessMethod = getRevokeOrgAccessMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.RevokeOrgAccessInput, com.google.protobuf.Empty>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "revokeOrgAccess"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.RevokeOrgAccessInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  com.google.protobuf.Empty.getDefaultInstance()))
              .setSchemaDescriptor(new GrantCommandControllerMethodDescriptorSupplier("revokeOrgAccess"))
              .build();
        }
      }
    }
    return getRevokeOrgAccessMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.RevokeOrgAccessInput,
      com.google.protobuf.Empty> getBootstrapRevokeOrgAccessMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "bootstrapRevokeOrgAccess",
      requestType = ai.stigmer.iam.grant.v1.RevokeOrgAccessInput.class,
      responseType = com.google.protobuf.Empty.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.RevokeOrgAccessInput,
      com.google.protobuf.Empty> getBootstrapRevokeOrgAccessMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.RevokeOrgAccessInput, com.google.protobuf.Empty> getBootstrapRevokeOrgAccessMethod;
    if ((getBootstrapRevokeOrgAccessMethod = GrantCommandControllerGrpc.getBootstrapRevokeOrgAccessMethod) == null) {
      synchronized (GrantCommandControllerGrpc.class) {
        if ((getBootstrapRevokeOrgAccessMethod = GrantCommandControllerGrpc.getBootstrapRevokeOrgAccessMethod) == null) {
          GrantCommandControllerGrpc.getBootstrapRevokeOrgAccessMethod = getBootstrapRevokeOrgAccessMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.RevokeOrgAccessInput, com.google.protobuf.Empty>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "bootstrapRevokeOrgAccess"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.RevokeOrgAccessInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  com.google.protobuf.Empty.getDefaultInstance()))
              .setSchemaDescriptor(new GrantCommandControllerMethodDescriptorSupplier("bootstrapRevokeOrgAccess"))
              .build();
        }
      }
    }
    return getBootstrapRevokeOrgAccessMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static GrantCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GrantCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GrantCommandControllerStub>() {
        @java.lang.Override
        public GrantCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GrantCommandControllerStub(channel, callOptions);
        }
      };
    return GrantCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static GrantCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GrantCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GrantCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public GrantCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GrantCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return GrantCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static GrantCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GrantCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GrantCommandControllerBlockingStub>() {
        @java.lang.Override
        public GrantCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GrantCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return GrantCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static GrantCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GrantCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GrantCommandControllerFutureStub>() {
        @java.lang.Override
        public GrantCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GrantCommandControllerFutureStub(channel, callOptions);
        }
      };
    return GrantCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * Grant Command Controller
   * This service manages the lifecycle of grants in Stigmer. One grant is one
   * role given to one principal on one resource; who holds what on a resource
   * is the set of its grants. Each grant connects three elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * A grant is the record; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each grant to an
   * OpenFGA tuple for fine-grained checks.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a new grant
     * Creates a single grant that gives a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * </pre>
     */
    default void create(ai.stigmer.iam.grant.v1.GrantSpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a single grant by spec
     * Removes an existing grant by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific grant without affecting others.
     * </pre>
     */
    default void delete(ai.stigmer.iam.grant.v1.GrantSpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Bootstrap grant during resource creation
     * Creates grants during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * </pre>
     */
    default void bootstrapGrant(ai.stigmer.iam.grant.v1.GrantSpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getBootstrapGrantMethod(), responseObserver);
    }

    /**
     * <pre>
     * Clean up every grant naming a deleted resource.
     * Removes all grants associated with a deleted resource.
     * </pre>
     */
    default void cleanupResourceGrants(ai.stigmer.iam.grant.v1.ApiResourceRef request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCleanupResourceGrantsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every grant it holds on the organization's resources: what was
     * shared with it (agents, vaults, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    default void revokeOrgAccess(ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRevokeOrgAccessMethod(), responseObserver);
    }

    /**
     * <pre>
     * Remove a person from an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * </pre>
     */
    default void bootstrapRevokeOrgAccess(ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getBootstrapRevokeOrgAccessMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service GrantCommandController.
   * <pre>
   * Grant Command Controller
   * This service manages the lifecycle of grants in Stigmer. One grant is one
   * role given to one principal on one resource; who holds what on a resource
   * is the set of its grants. Each grant connects three elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * A grant is the record; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each grant to an
   * OpenFGA tuple for fine-grained checks.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static abstract class GrantCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return GrantCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service GrantCommandController.
   * <pre>
   * Grant Command Controller
   * This service manages the lifecycle of grants in Stigmer. One grant is one
   * role given to one principal on one resource; who holds what on a resource
   * is the set of its grants. Each grant connects three elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * A grant is the record; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each grant to an
   * OpenFGA tuple for fine-grained checks.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static final class GrantCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<GrantCommandControllerStub> {
    private GrantCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GrantCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GrantCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new grant
     * Creates a single grant that gives a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * </pre>
     */
    public void create(ai.stigmer.iam.grant.v1.GrantSpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a single grant by spec
     * Removes an existing grant by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific grant without affecting others.
     * </pre>
     */
    public void delete(ai.stigmer.iam.grant.v1.GrantSpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Bootstrap grant during resource creation
     * Creates grants during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * </pre>
     */
    public void bootstrapGrant(ai.stigmer.iam.grant.v1.GrantSpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getBootstrapGrantMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Clean up every grant naming a deleted resource.
     * Removes all grants associated with a deleted resource.
     * </pre>
     */
    public void cleanupResourceGrants(ai.stigmer.iam.grant.v1.ApiResourceRef request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCleanupResourceGrantsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every grant it holds on the organization's resources: what was
     * shared with it (agents, vaults, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    public void revokeOrgAccess(ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRevokeOrgAccessMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Remove a person from an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * </pre>
     */
    public void bootstrapRevokeOrgAccess(ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getBootstrapRevokeOrgAccessMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service GrantCommandController.
   * <pre>
   * Grant Command Controller
   * This service manages the lifecycle of grants in Stigmer. One grant is one
   * role given to one principal on one resource; who holds what on a resource
   * is the set of its grants. Each grant connects three elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * A grant is the record; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each grant to an
   * OpenFGA tuple for fine-grained checks.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static final class GrantCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<GrantCommandControllerBlockingV2Stub> {
    private GrantCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GrantCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GrantCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new grant
     * Creates a single grant that gives a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.Grant create(ai.stigmer.iam.grant.v1.GrantSpec request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a single grant by spec
     * Removes an existing grant by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific grant without affecting others.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.Grant delete(ai.stigmer.iam.grant.v1.GrantSpec request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Bootstrap grant during resource creation
     * Creates grants during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.Grant bootstrapGrant(ai.stigmer.iam.grant.v1.GrantSpec request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getBootstrapGrantMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Clean up every grant naming a deleted resource.
     * Removes all grants associated with a deleted resource.
     * </pre>
     */
    public com.google.protobuf.Empty cleanupResourceGrants(ai.stigmer.iam.grant.v1.ApiResourceRef request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCleanupResourceGrantsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every grant it holds on the organization's resources: what was
     * shared with it (agents, vaults, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    public com.google.protobuf.Empty revokeOrgAccess(ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRevokeOrgAccessMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove a person from an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * </pre>
     */
    public com.google.protobuf.Empty bootstrapRevokeOrgAccess(ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getBootstrapRevokeOrgAccessMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service GrantCommandController.
   * <pre>
   * Grant Command Controller
   * This service manages the lifecycle of grants in Stigmer. One grant is one
   * role given to one principal on one resource; who holds what on a resource
   * is the set of its grants. Each grant connects three elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * A grant is the record; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each grant to an
   * OpenFGA tuple for fine-grained checks.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static final class GrantCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<GrantCommandControllerBlockingStub> {
    private GrantCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GrantCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GrantCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new grant
     * Creates a single grant that gives a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.Grant create(ai.stigmer.iam.grant.v1.GrantSpec request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a single grant by spec
     * Removes an existing grant by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific grant without affecting others.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.Grant delete(ai.stigmer.iam.grant.v1.GrantSpec request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Bootstrap grant during resource creation
     * Creates grants during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.Grant bootstrapGrant(ai.stigmer.iam.grant.v1.GrantSpec request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getBootstrapGrantMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Clean up every grant naming a deleted resource.
     * Removes all grants associated with a deleted resource.
     * </pre>
     */
    public com.google.protobuf.Empty cleanupResourceGrants(ai.stigmer.iam.grant.v1.ApiResourceRef request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCleanupResourceGrantsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every grant it holds on the organization's resources: what was
     * shared with it (agents, vaults, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    public com.google.protobuf.Empty revokeOrgAccess(ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRevokeOrgAccessMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove a person from an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * </pre>
     */
    public com.google.protobuf.Empty bootstrapRevokeOrgAccess(ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getBootstrapRevokeOrgAccessMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service GrantCommandController.
   * <pre>
   * Grant Command Controller
   * This service manages the lifecycle of grants in Stigmer. One grant is one
   * role given to one principal on one resource; who holds what on a resource
   * is the set of its grants. Each grant connects three elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * A grant is the record; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each grant to an
   * OpenFGA tuple for fine-grained checks.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static final class GrantCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<GrantCommandControllerFutureStub> {
    private GrantCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GrantCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GrantCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new grant
     * Creates a single grant that gives a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.Grant> create(
        ai.stigmer.iam.grant.v1.GrantSpec request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a single grant by spec
     * Removes an existing grant by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific grant without affecting others.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.Grant> delete(
        ai.stigmer.iam.grant.v1.GrantSpec request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Bootstrap grant during resource creation
     * Creates grants during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.Grant> bootstrapGrant(
        ai.stigmer.iam.grant.v1.GrantSpec request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getBootstrapGrantMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Clean up every grant naming a deleted resource.
     * Removes all grants associated with a deleted resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<com.google.protobuf.Empty> cleanupResourceGrants(
        ai.stigmer.iam.grant.v1.ApiResourceRef request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCleanupResourceGrantsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every grant it holds on the organization's resources: what was
     * shared with it (agents, vaults, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<com.google.protobuf.Empty> revokeOrgAccess(
        ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRevokeOrgAccessMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Remove a person from an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<com.google.protobuf.Empty> bootstrapRevokeOrgAccess(
        ai.stigmer.iam.grant.v1.RevokeOrgAccessInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getBootstrapRevokeOrgAccessMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_DELETE = 1;
  private static final int METHODID_BOOTSTRAP_GRANT = 2;
  private static final int METHODID_CLEANUP_RESOURCE_GRANTS = 3;
  private static final int METHODID_REVOKE_ORG_ACCESS = 4;
  private static final int METHODID_BOOTSTRAP_REVOKE_ORG_ACCESS = 5;

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
          serviceImpl.create((ai.stigmer.iam.grant.v1.GrantSpec) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.iam.grant.v1.GrantSpec) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant>) responseObserver);
          break;
        case METHODID_BOOTSTRAP_GRANT:
          serviceImpl.bootstrapGrant((ai.stigmer.iam.grant.v1.GrantSpec) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant>) responseObserver);
          break;
        case METHODID_CLEANUP_RESOURCE_GRANTS:
          serviceImpl.cleanupResourceGrants((ai.stigmer.iam.grant.v1.ApiResourceRef) request,
              (io.grpc.stub.StreamObserver<com.google.protobuf.Empty>) responseObserver);
          break;
        case METHODID_REVOKE_ORG_ACCESS:
          serviceImpl.revokeOrgAccess((ai.stigmer.iam.grant.v1.RevokeOrgAccessInput) request,
              (io.grpc.stub.StreamObserver<com.google.protobuf.Empty>) responseObserver);
          break;
        case METHODID_BOOTSTRAP_REVOKE_ORG_ACCESS:
          serviceImpl.bootstrapRevokeOrgAccess((ai.stigmer.iam.grant.v1.RevokeOrgAccessInput) request,
              (io.grpc.stub.StreamObserver<com.google.protobuf.Empty>) responseObserver);
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
              ai.stigmer.iam.grant.v1.GrantSpec,
              ai.stigmer.iam.grant.v1.Grant>(
                service, METHODID_CREATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.GrantSpec,
              ai.stigmer.iam.grant.v1.Grant>(
                service, METHODID_DELETE)))
        .addMethod(
          getBootstrapGrantMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.GrantSpec,
              ai.stigmer.iam.grant.v1.Grant>(
                service, METHODID_BOOTSTRAP_GRANT)))
        .addMethod(
          getCleanupResourceGrantsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.ApiResourceRef,
              com.google.protobuf.Empty>(
                service, METHODID_CLEANUP_RESOURCE_GRANTS)))
        .addMethod(
          getRevokeOrgAccessMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.RevokeOrgAccessInput,
              com.google.protobuf.Empty>(
                service, METHODID_REVOKE_ORG_ACCESS)))
        .addMethod(
          getBootstrapRevokeOrgAccessMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.RevokeOrgAccessInput,
              com.google.protobuf.Empty>(
                service, METHODID_BOOTSTRAP_REVOKE_ORG_ACCESS)))
        .build();
  }

  private static abstract class GrantCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    GrantCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.grant.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("GrantCommandController");
    }
  }

  private static final class GrantCommandControllerFileDescriptorSupplier
      extends GrantCommandControllerBaseDescriptorSupplier {
    GrantCommandControllerFileDescriptorSupplier() {}
  }

  private static final class GrantCommandControllerMethodDescriptorSupplier
      extends GrantCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    GrantCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (GrantCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new GrantCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getBootstrapGrantMethod())
              .addMethod(getCleanupResourceGrantsMethod())
              .addMethod(getRevokeOrgAccessMethod())
              .addMethod(getBootstrapRevokeOrgAccessMethod())
              .build();
        }
      }
    }
    return result;
  }
}
