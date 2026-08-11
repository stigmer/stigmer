package ai.stigmer.iam.iampolicy.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * IAM Policy Command Controller
 * This service manages the lifecycle of IAM policies in Stigmer.
 * IAM policies define access control rules by connecting three key elements:
 * - Principal: WHO gets access (user, team, etc.)
 * - Resource: WHAT is being accessed (any API resource)
 * - Relation: HOW they can access it (viewer, admin, user, etc.)
 * Under the hood, each IAM policy creates an OpenFGA tuple that enforces
 * the permission in the authorization system.
 * Common Use Cases:
 * - Granting users access to organizations
 * - Setting up team-based access control
 * - Managing fine-grained permissions on any resource
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class IamPolicyCommandControllerGrpc {

  private IamPolicyCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.iampolicy.v1.IamPolicyCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicySpec,
      ai.stigmer.iam.iampolicy.v1.IamPolicy> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.iam.iampolicy.v1.IamPolicySpec.class,
      responseType = ai.stigmer.iam.iampolicy.v1.IamPolicy.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicySpec,
      ai.stigmer.iam.iampolicy.v1.IamPolicy> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicySpec, ai.stigmer.iam.iampolicy.v1.IamPolicy> getCreateMethod;
    if ((getCreateMethod = IamPolicyCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (IamPolicyCommandControllerGrpc.class) {
        if ((getCreateMethod = IamPolicyCommandControllerGrpc.getCreateMethod) == null) {
          IamPolicyCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.IamPolicySpec, ai.stigmer.iam.iampolicy.v1.IamPolicy>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.IamPolicySpec.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.IamPolicy.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicySpec,
      ai.stigmer.iam.iampolicy.v1.IamPolicy> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.iam.iampolicy.v1.IamPolicySpec.class,
      responseType = ai.stigmer.iam.iampolicy.v1.IamPolicy.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicySpec,
      ai.stigmer.iam.iampolicy.v1.IamPolicy> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicySpec, ai.stigmer.iam.iampolicy.v1.IamPolicy> getDeleteMethod;
    if ((getDeleteMethod = IamPolicyCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (IamPolicyCommandControllerGrpc.class) {
        if ((getDeleteMethod = IamPolicyCommandControllerGrpc.getDeleteMethod) == null) {
          IamPolicyCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.IamPolicySpec, ai.stigmer.iam.iampolicy.v1.IamPolicy>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.IamPolicySpec.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.IamPolicy.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicySpec,
      ai.stigmer.iam.iampolicy.v1.IamPolicy> getBootstrapPolicyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "bootstrapPolicy",
      requestType = ai.stigmer.iam.iampolicy.v1.IamPolicySpec.class,
      responseType = ai.stigmer.iam.iampolicy.v1.IamPolicy.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicySpec,
      ai.stigmer.iam.iampolicy.v1.IamPolicy> getBootstrapPolicyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicySpec, ai.stigmer.iam.iampolicy.v1.IamPolicy> getBootstrapPolicyMethod;
    if ((getBootstrapPolicyMethod = IamPolicyCommandControllerGrpc.getBootstrapPolicyMethod) == null) {
      synchronized (IamPolicyCommandControllerGrpc.class) {
        if ((getBootstrapPolicyMethod = IamPolicyCommandControllerGrpc.getBootstrapPolicyMethod) == null) {
          IamPolicyCommandControllerGrpc.getBootstrapPolicyMethod = getBootstrapPolicyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.IamPolicySpec, ai.stigmer.iam.iampolicy.v1.IamPolicy>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "bootstrapPolicy"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.IamPolicySpec.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.IamPolicy.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyCommandControllerMethodDescriptorSupplier("bootstrapPolicy"))
              .build();
        }
      }
    }
    return getBootstrapPolicyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ApiResourceRef,
      com.google.protobuf.Empty> getCleanupResourcePoliciesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cleanupResourcePolicies",
      requestType = ai.stigmer.iam.iampolicy.v1.ApiResourceRef.class,
      responseType = com.google.protobuf.Empty.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ApiResourceRef,
      com.google.protobuf.Empty> getCleanupResourcePoliciesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ApiResourceRef, com.google.protobuf.Empty> getCleanupResourcePoliciesMethod;
    if ((getCleanupResourcePoliciesMethod = IamPolicyCommandControllerGrpc.getCleanupResourcePoliciesMethod) == null) {
      synchronized (IamPolicyCommandControllerGrpc.class) {
        if ((getCleanupResourcePoliciesMethod = IamPolicyCommandControllerGrpc.getCleanupResourcePoliciesMethod) == null) {
          IamPolicyCommandControllerGrpc.getCleanupResourcePoliciesMethod = getCleanupResourcePoliciesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.ApiResourceRef, com.google.protobuf.Empty>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cleanupResourcePolicies"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.ApiResourceRef.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  com.google.protobuf.Empty.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyCommandControllerMethodDescriptorSupplier("cleanupResourcePolicies"))
              .build();
        }
      }
    }
    return getCleanupResourcePoliciesMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput,
      com.google.protobuf.Empty> getRevokeOrgAccessMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "revokeOrgAccess",
      requestType = ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput.class,
      responseType = com.google.protobuf.Empty.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput,
      com.google.protobuf.Empty> getRevokeOrgAccessMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput, com.google.protobuf.Empty> getRevokeOrgAccessMethod;
    if ((getRevokeOrgAccessMethod = IamPolicyCommandControllerGrpc.getRevokeOrgAccessMethod) == null) {
      synchronized (IamPolicyCommandControllerGrpc.class) {
        if ((getRevokeOrgAccessMethod = IamPolicyCommandControllerGrpc.getRevokeOrgAccessMethod) == null) {
          IamPolicyCommandControllerGrpc.getRevokeOrgAccessMethod = getRevokeOrgAccessMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput, com.google.protobuf.Empty>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "revokeOrgAccess"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  com.google.protobuf.Empty.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyCommandControllerMethodDescriptorSupplier("revokeOrgAccess"))
              .build();
        }
      }
    }
    return getRevokeOrgAccessMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput,
      com.google.protobuf.Empty> getBootstrapRevokeOrgAccessMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "bootstrapRevokeOrgAccess",
      requestType = ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput.class,
      responseType = com.google.protobuf.Empty.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput,
      com.google.protobuf.Empty> getBootstrapRevokeOrgAccessMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput, com.google.protobuf.Empty> getBootstrapRevokeOrgAccessMethod;
    if ((getBootstrapRevokeOrgAccessMethod = IamPolicyCommandControllerGrpc.getBootstrapRevokeOrgAccessMethod) == null) {
      synchronized (IamPolicyCommandControllerGrpc.class) {
        if ((getBootstrapRevokeOrgAccessMethod = IamPolicyCommandControllerGrpc.getBootstrapRevokeOrgAccessMethod) == null) {
          IamPolicyCommandControllerGrpc.getBootstrapRevokeOrgAccessMethod = getBootstrapRevokeOrgAccessMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput, com.google.protobuf.Empty>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "bootstrapRevokeOrgAccess"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  com.google.protobuf.Empty.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyCommandControllerMethodDescriptorSupplier("bootstrapRevokeOrgAccess"))
              .build();
        }
      }
    }
    return getBootstrapRevokeOrgAccessMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static IamPolicyCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IamPolicyCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IamPolicyCommandControllerStub>() {
        @java.lang.Override
        public IamPolicyCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IamPolicyCommandControllerStub(channel, callOptions);
        }
      };
    return IamPolicyCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static IamPolicyCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IamPolicyCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IamPolicyCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public IamPolicyCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IamPolicyCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return IamPolicyCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static IamPolicyCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IamPolicyCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IamPolicyCommandControllerBlockingStub>() {
        @java.lang.Override
        public IamPolicyCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IamPolicyCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return IamPolicyCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static IamPolicyCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IamPolicyCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IamPolicyCommandControllerFutureStub>() {
        @java.lang.Override
        public IamPolicyCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IamPolicyCommandControllerFutureStub(channel, callOptions);
        }
      };
    return IamPolicyCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * IAM Policy Command Controller
   * This service manages the lifecycle of IAM policies in Stigmer.
   * IAM policies define access control rules by connecting three key elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * Under the hood, each IAM policy creates an OpenFGA tuple that enforces
   * the permission in the authorization system.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a new IAM policy
     * Creates a single IAM policy that grants a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * &#64;internal
     * The operation:
     * 1. Validates the input (principal, resource, relation are all valid)
     * 2. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 3. Creates the policy in the database with auto-generated ID and metadata
     * 4. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE being shared
     * - This ensures only resource owners/admins can grant access to their resources
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result:
     *   Created IamPolicy with auto-generated ID (e.g., "iamp_01HQ...")
     *   Alice can view (but not modify) the organization
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    default void create(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a single IAM policy by spec
     * Removes an existing IAM policy by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific policy without affecting others.
     * &#64;internal
     * The operation:
     * 1. Finds the policy by matching principal+resource+relation
     * 2. Removes it from the database
     * 3. Deletes the corresponding tuple from OpenFGA
     * 4. If no matching policy exists, the operation is idempotent (no error)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE referenced in the policy
     * Use Cases:
     * - Revoking a specific permission from a user
     * - Removing access after a team member leaves
     * - Cleaning up individual policies
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result: The policy granting Alice viewer access to the organization is deleted
     * Input: IamPolicySpec identifying the policy to delete (principal, resource, relation)
     * Output: The deleted IamPolicy object (for audit/confirmation purposes)
     * </pre>
     */
    default void delete(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Bootstrap IAM policy during resource creation
     * Creates IAM policies during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * &#64;internal
     * Solves the chicken-and-egg problem where creating the first policy for a resource
     * requires authorization, but authorization requires that first policy.
     * The operation:
     * 1. Validates that caller has can_bootstrap_iam permission on platform:stigmer
     * 2. Validates the input (principal, resource, relation are all valid)
     * 3. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 4. Creates the policy in the database with auto-generated ID and metadata
     * 5. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only called by resource creation handlers running as machine accounts
     * Use Cases:
     * - Creating scope links (agent#organization&#64;organization:acme) during agent creation
     * - Creating owner relations (agent#owner&#64;identity_account:alice) during agent creation
     * - Establishing initial authorization tuples for any newly created resource
     * Example:
     * Input:
     *   principal: {kind: "organization", id: "org_demo-123"}
     *   resource: {kind: "agent", id: "agt_abc-456"}
     *   relation: "organization"
     * Result:
     *   Created IamPolicy establishing agent's organization scope
     *   Subsequent IAM policy operations can now use standard authorization
     * Note: After the bootstrap policies are created, subsequent IAM policy modifications
     * must use the standard 'create' RPC which requires 'can_grant_access' permission.
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    default void bootstrapPolicy(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getBootstrapPolicyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cleanup all IAM policies for a deleted resource.
     * Removes all IAM policies associated with a deleted resource.
     * &#64;internal
     * Performs bidirectional cleanup:
     * 1. Policies where resource is the TARGET (policies granting access TO this resource)
     * 2. Policies where resource is the PRINCIPAL (policies where this resource HAS access)
     * The operation:
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Finds all policies where resource_id appears (as principal OR resource)
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA
     * 5. Returns Empty (idempotent if no policies exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services
     * Use Cases:
     * - Resource deletion cleanup
     * - Preventing orphaned FGA tuples
     * - Maintaining authorization system integrity
     * Example:
     * Input: {kind: "organization", id: "org_demo-123"}
     * Result: All policies referencing org_demo-123 are deleted
     * Input: ApiResourceRef with resource kind and ID
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    default void cleanupResourcePolicies(ai.stigmer.iam.iampolicy.v1.ApiResourceRef request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCleanupResourcePoliciesMethod(), responseObserver);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization.
     * Removes every IAM policy that grants the specified identity account access to
     * resources within the given organization, including policies on the organization
     * itself and on child resources (environments, agents, etc.).
     * &#64;internal
     * The operation:
     * 1. Validates the input (identity_account_id and organization_id are present)
     * 2. Authorizes caller (can_grant_access on the organization)
     * 3. Loads all policies where the user is principal within the org scope
     * 4. Deletes all matching policies from MongoDB
     * 5. Removes all corresponding tuples from OpenFGA
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the organization
     * - System flows running as the platform machine account cannot satisfy this
     *   check (the machine account holds no org-scoped grants by design) and must
     *   use bootstrapRevokeOrgAccess instead
     * Use Cases:
     * - Removing a member from an organization
     * - Offboarding a user from all org resources in one operation
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    default void revokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRevokeOrgAccessMethod(), responseObserver);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * &#64;internal
     * Exists because system flows execute the revoke as the platform machine
     * account, which by design holds no org-scoped grants. The system channel does
     * NOT bypass authorization — it authenticates as the machine account, which
     * can only satisfy platform-scoped permissions. revokeOrgAccess therefore
     * always fails with PERMISSION_DENIED on the system channel; this RPC is the
     * sanctioned path, mirroring how bootstrapPolicy is the system-path twin of
     * create (see https://github.com/stigmer/stigmer/issues/332).
     * The operation (identical to revokeOrgAccess after authorization):
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Loads all policies where the identity account is principal within the org
     *    scope, plus policies directly on the organization itself
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA (idempotent if none exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services (machine accounts)
     * Use Cases:
     * - Federated account deprovisioning (deprovisionFederatedAccount's revoke step)
     * - Any platform-driven offboarding that runs under system credentials
     * End-user member removal must use revokeOrgAccess, which checks
     * can_grant_access on the organization.
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    default void bootstrapRevokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getBootstrapRevokeOrgAccessMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service IamPolicyCommandController.
   * <pre>
   * IAM Policy Command Controller
   * This service manages the lifecycle of IAM policies in Stigmer.
   * IAM policies define access control rules by connecting three key elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * Under the hood, each IAM policy creates an OpenFGA tuple that enforces
   * the permission in the authorization system.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static abstract class IamPolicyCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return IamPolicyCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service IamPolicyCommandController.
   * <pre>
   * IAM Policy Command Controller
   * This service manages the lifecycle of IAM policies in Stigmer.
   * IAM policies define access control rules by connecting three key elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * Under the hood, each IAM policy creates an OpenFGA tuple that enforces
   * the permission in the authorization system.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static final class IamPolicyCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<IamPolicyCommandControllerStub> {
    private IamPolicyCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IamPolicyCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IamPolicyCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new IAM policy
     * Creates a single IAM policy that grants a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * &#64;internal
     * The operation:
     * 1. Validates the input (principal, resource, relation are all valid)
     * 2. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 3. Creates the policy in the database with auto-generated ID and metadata
     * 4. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE being shared
     * - This ensures only resource owners/admins can grant access to their resources
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result:
     *   Created IamPolicy with auto-generated ID (e.g., "iamp_01HQ...")
     *   Alice can view (but not modify) the organization
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    public void create(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a single IAM policy by spec
     * Removes an existing IAM policy by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific policy without affecting others.
     * &#64;internal
     * The operation:
     * 1. Finds the policy by matching principal+resource+relation
     * 2. Removes it from the database
     * 3. Deletes the corresponding tuple from OpenFGA
     * 4. If no matching policy exists, the operation is idempotent (no error)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE referenced in the policy
     * Use Cases:
     * - Revoking a specific permission from a user
     * - Removing access after a team member leaves
     * - Cleaning up individual policies
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result: The policy granting Alice viewer access to the organization is deleted
     * Input: IamPolicySpec identifying the policy to delete (principal, resource, relation)
     * Output: The deleted IamPolicy object (for audit/confirmation purposes)
     * </pre>
     */
    public void delete(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Bootstrap IAM policy during resource creation
     * Creates IAM policies during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * &#64;internal
     * Solves the chicken-and-egg problem where creating the first policy for a resource
     * requires authorization, but authorization requires that first policy.
     * The operation:
     * 1. Validates that caller has can_bootstrap_iam permission on platform:stigmer
     * 2. Validates the input (principal, resource, relation are all valid)
     * 3. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 4. Creates the policy in the database with auto-generated ID and metadata
     * 5. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only called by resource creation handlers running as machine accounts
     * Use Cases:
     * - Creating scope links (agent#organization&#64;organization:acme) during agent creation
     * - Creating owner relations (agent#owner&#64;identity_account:alice) during agent creation
     * - Establishing initial authorization tuples for any newly created resource
     * Example:
     * Input:
     *   principal: {kind: "organization", id: "org_demo-123"}
     *   resource: {kind: "agent", id: "agt_abc-456"}
     *   relation: "organization"
     * Result:
     *   Created IamPolicy establishing agent's organization scope
     *   Subsequent IAM policy operations can now use standard authorization
     * Note: After the bootstrap policies are created, subsequent IAM policy modifications
     * must use the standard 'create' RPC which requires 'can_grant_access' permission.
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    public void bootstrapPolicy(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getBootstrapPolicyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cleanup all IAM policies for a deleted resource.
     * Removes all IAM policies associated with a deleted resource.
     * &#64;internal
     * Performs bidirectional cleanup:
     * 1. Policies where resource is the TARGET (policies granting access TO this resource)
     * 2. Policies where resource is the PRINCIPAL (policies where this resource HAS access)
     * The operation:
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Finds all policies where resource_id appears (as principal OR resource)
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA
     * 5. Returns Empty (idempotent if no policies exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services
     * Use Cases:
     * - Resource deletion cleanup
     * - Preventing orphaned FGA tuples
     * - Maintaining authorization system integrity
     * Example:
     * Input: {kind: "organization", id: "org_demo-123"}
     * Result: All policies referencing org_demo-123 are deleted
     * Input: ApiResourceRef with resource kind and ID
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public void cleanupResourcePolicies(ai.stigmer.iam.iampolicy.v1.ApiResourceRef request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCleanupResourcePoliciesMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization.
     * Removes every IAM policy that grants the specified identity account access to
     * resources within the given organization, including policies on the organization
     * itself and on child resources (environments, agents, etc.).
     * &#64;internal
     * The operation:
     * 1. Validates the input (identity_account_id and organization_id are present)
     * 2. Authorizes caller (can_grant_access on the organization)
     * 3. Loads all policies where the user is principal within the org scope
     * 4. Deletes all matching policies from MongoDB
     * 5. Removes all corresponding tuples from OpenFGA
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the organization
     * - System flows running as the platform machine account cannot satisfy this
     *   check (the machine account holds no org-scoped grants by design) and must
     *   use bootstrapRevokeOrgAccess instead
     * Use Cases:
     * - Removing a member from an organization
     * - Offboarding a user from all org resources in one operation
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public void revokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRevokeOrgAccessMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * &#64;internal
     * Exists because system flows execute the revoke as the platform machine
     * account, which by design holds no org-scoped grants. The system channel does
     * NOT bypass authorization — it authenticates as the machine account, which
     * can only satisfy platform-scoped permissions. revokeOrgAccess therefore
     * always fails with PERMISSION_DENIED on the system channel; this RPC is the
     * sanctioned path, mirroring how bootstrapPolicy is the system-path twin of
     * create (see https://github.com/stigmer/stigmer/issues/332).
     * The operation (identical to revokeOrgAccess after authorization):
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Loads all policies where the identity account is principal within the org
     *    scope, plus policies directly on the organization itself
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA (idempotent if none exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services (machine accounts)
     * Use Cases:
     * - Federated account deprovisioning (deprovisionFederatedAccount's revoke step)
     * - Any platform-driven offboarding that runs under system credentials
     * End-user member removal must use revokeOrgAccess, which checks
     * can_grant_access on the organization.
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public void bootstrapRevokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getBootstrapRevokeOrgAccessMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service IamPolicyCommandController.
   * <pre>
   * IAM Policy Command Controller
   * This service manages the lifecycle of IAM policies in Stigmer.
   * IAM policies define access control rules by connecting three key elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * Under the hood, each IAM policy creates an OpenFGA tuple that enforces
   * the permission in the authorization system.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static final class IamPolicyCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<IamPolicyCommandControllerBlockingV2Stub> {
    private IamPolicyCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IamPolicyCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IamPolicyCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new IAM policy
     * Creates a single IAM policy that grants a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * &#64;internal
     * The operation:
     * 1. Validates the input (principal, resource, relation are all valid)
     * 2. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 3. Creates the policy in the database with auto-generated ID and metadata
     * 4. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE being shared
     * - This ensures only resource owners/admins can grant access to their resources
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result:
     *   Created IamPolicy with auto-generated ID (e.g., "iamp_01HQ...")
     *   Alice can view (but not modify) the organization
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.IamPolicy create(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a single IAM policy by spec
     * Removes an existing IAM policy by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific policy without affecting others.
     * &#64;internal
     * The operation:
     * 1. Finds the policy by matching principal+resource+relation
     * 2. Removes it from the database
     * 3. Deletes the corresponding tuple from OpenFGA
     * 4. If no matching policy exists, the operation is idempotent (no error)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE referenced in the policy
     * Use Cases:
     * - Revoking a specific permission from a user
     * - Removing access after a team member leaves
     * - Cleaning up individual policies
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result: The policy granting Alice viewer access to the organization is deleted
     * Input: IamPolicySpec identifying the policy to delete (principal, resource, relation)
     * Output: The deleted IamPolicy object (for audit/confirmation purposes)
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.IamPolicy delete(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Bootstrap IAM policy during resource creation
     * Creates IAM policies during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * &#64;internal
     * Solves the chicken-and-egg problem where creating the first policy for a resource
     * requires authorization, but authorization requires that first policy.
     * The operation:
     * 1. Validates that caller has can_bootstrap_iam permission on platform:stigmer
     * 2. Validates the input (principal, resource, relation are all valid)
     * 3. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 4. Creates the policy in the database with auto-generated ID and metadata
     * 5. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only called by resource creation handlers running as machine accounts
     * Use Cases:
     * - Creating scope links (agent#organization&#64;organization:acme) during agent creation
     * - Creating owner relations (agent#owner&#64;identity_account:alice) during agent creation
     * - Establishing initial authorization tuples for any newly created resource
     * Example:
     * Input:
     *   principal: {kind: "organization", id: "org_demo-123"}
     *   resource: {kind: "agent", id: "agt_abc-456"}
     *   relation: "organization"
     * Result:
     *   Created IamPolicy establishing agent's organization scope
     *   Subsequent IAM policy operations can now use standard authorization
     * Note: After the bootstrap policies are created, subsequent IAM policy modifications
     * must use the standard 'create' RPC which requires 'can_grant_access' permission.
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.IamPolicy bootstrapPolicy(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getBootstrapPolicyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cleanup all IAM policies for a deleted resource.
     * Removes all IAM policies associated with a deleted resource.
     * &#64;internal
     * Performs bidirectional cleanup:
     * 1. Policies where resource is the TARGET (policies granting access TO this resource)
     * 2. Policies where resource is the PRINCIPAL (policies where this resource HAS access)
     * The operation:
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Finds all policies where resource_id appears (as principal OR resource)
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA
     * 5. Returns Empty (idempotent if no policies exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services
     * Use Cases:
     * - Resource deletion cleanup
     * - Preventing orphaned FGA tuples
     * - Maintaining authorization system integrity
     * Example:
     * Input: {kind: "organization", id: "org_demo-123"}
     * Result: All policies referencing org_demo-123 are deleted
     * Input: ApiResourceRef with resource kind and ID
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public com.google.protobuf.Empty cleanupResourcePolicies(ai.stigmer.iam.iampolicy.v1.ApiResourceRef request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCleanupResourcePoliciesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization.
     * Removes every IAM policy that grants the specified identity account access to
     * resources within the given organization, including policies on the organization
     * itself and on child resources (environments, agents, etc.).
     * &#64;internal
     * The operation:
     * 1. Validates the input (identity_account_id and organization_id are present)
     * 2. Authorizes caller (can_grant_access on the organization)
     * 3. Loads all policies where the user is principal within the org scope
     * 4. Deletes all matching policies from MongoDB
     * 5. Removes all corresponding tuples from OpenFGA
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the organization
     * - System flows running as the platform machine account cannot satisfy this
     *   check (the machine account holds no org-scoped grants by design) and must
     *   use bootstrapRevokeOrgAccess instead
     * Use Cases:
     * - Removing a member from an organization
     * - Offboarding a user from all org resources in one operation
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public com.google.protobuf.Empty revokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRevokeOrgAccessMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * &#64;internal
     * Exists because system flows execute the revoke as the platform machine
     * account, which by design holds no org-scoped grants. The system channel does
     * NOT bypass authorization — it authenticates as the machine account, which
     * can only satisfy platform-scoped permissions. revokeOrgAccess therefore
     * always fails with PERMISSION_DENIED on the system channel; this RPC is the
     * sanctioned path, mirroring how bootstrapPolicy is the system-path twin of
     * create (see https://github.com/stigmer/stigmer/issues/332).
     * The operation (identical to revokeOrgAccess after authorization):
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Loads all policies where the identity account is principal within the org
     *    scope, plus policies directly on the organization itself
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA (idempotent if none exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services (machine accounts)
     * Use Cases:
     * - Federated account deprovisioning (deprovisionFederatedAccount's revoke step)
     * - Any platform-driven offboarding that runs under system credentials
     * End-user member removal must use revokeOrgAccess, which checks
     * can_grant_access on the organization.
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public com.google.protobuf.Empty bootstrapRevokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getBootstrapRevokeOrgAccessMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service IamPolicyCommandController.
   * <pre>
   * IAM Policy Command Controller
   * This service manages the lifecycle of IAM policies in Stigmer.
   * IAM policies define access control rules by connecting three key elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * Under the hood, each IAM policy creates an OpenFGA tuple that enforces
   * the permission in the authorization system.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static final class IamPolicyCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<IamPolicyCommandControllerBlockingStub> {
    private IamPolicyCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IamPolicyCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IamPolicyCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new IAM policy
     * Creates a single IAM policy that grants a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * &#64;internal
     * The operation:
     * 1. Validates the input (principal, resource, relation are all valid)
     * 2. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 3. Creates the policy in the database with auto-generated ID and metadata
     * 4. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE being shared
     * - This ensures only resource owners/admins can grant access to their resources
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result:
     *   Created IamPolicy with auto-generated ID (e.g., "iamp_01HQ...")
     *   Alice can view (but not modify) the organization
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.IamPolicy create(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a single IAM policy by spec
     * Removes an existing IAM policy by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific policy without affecting others.
     * &#64;internal
     * The operation:
     * 1. Finds the policy by matching principal+resource+relation
     * 2. Removes it from the database
     * 3. Deletes the corresponding tuple from OpenFGA
     * 4. If no matching policy exists, the operation is idempotent (no error)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE referenced in the policy
     * Use Cases:
     * - Revoking a specific permission from a user
     * - Removing access after a team member leaves
     * - Cleaning up individual policies
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result: The policy granting Alice viewer access to the organization is deleted
     * Input: IamPolicySpec identifying the policy to delete (principal, resource, relation)
     * Output: The deleted IamPolicy object (for audit/confirmation purposes)
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.IamPolicy delete(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Bootstrap IAM policy during resource creation
     * Creates IAM policies during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * &#64;internal
     * Solves the chicken-and-egg problem where creating the first policy for a resource
     * requires authorization, but authorization requires that first policy.
     * The operation:
     * 1. Validates that caller has can_bootstrap_iam permission on platform:stigmer
     * 2. Validates the input (principal, resource, relation are all valid)
     * 3. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 4. Creates the policy in the database with auto-generated ID and metadata
     * 5. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only called by resource creation handlers running as machine accounts
     * Use Cases:
     * - Creating scope links (agent#organization&#64;organization:acme) during agent creation
     * - Creating owner relations (agent#owner&#64;identity_account:alice) during agent creation
     * - Establishing initial authorization tuples for any newly created resource
     * Example:
     * Input:
     *   principal: {kind: "organization", id: "org_demo-123"}
     *   resource: {kind: "agent", id: "agt_abc-456"}
     *   relation: "organization"
     * Result:
     *   Created IamPolicy establishing agent's organization scope
     *   Subsequent IAM policy operations can now use standard authorization
     * Note: After the bootstrap policies are created, subsequent IAM policy modifications
     * must use the standard 'create' RPC which requires 'can_grant_access' permission.
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.IamPolicy bootstrapPolicy(ai.stigmer.iam.iampolicy.v1.IamPolicySpec request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getBootstrapPolicyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cleanup all IAM policies for a deleted resource.
     * Removes all IAM policies associated with a deleted resource.
     * &#64;internal
     * Performs bidirectional cleanup:
     * 1. Policies where resource is the TARGET (policies granting access TO this resource)
     * 2. Policies where resource is the PRINCIPAL (policies where this resource HAS access)
     * The operation:
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Finds all policies where resource_id appears (as principal OR resource)
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA
     * 5. Returns Empty (idempotent if no policies exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services
     * Use Cases:
     * - Resource deletion cleanup
     * - Preventing orphaned FGA tuples
     * - Maintaining authorization system integrity
     * Example:
     * Input: {kind: "organization", id: "org_demo-123"}
     * Result: All policies referencing org_demo-123 are deleted
     * Input: ApiResourceRef with resource kind and ID
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public com.google.protobuf.Empty cleanupResourcePolicies(ai.stigmer.iam.iampolicy.v1.ApiResourceRef request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCleanupResourcePoliciesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization.
     * Removes every IAM policy that grants the specified identity account access to
     * resources within the given organization, including policies on the organization
     * itself and on child resources (environments, agents, etc.).
     * &#64;internal
     * The operation:
     * 1. Validates the input (identity_account_id and organization_id are present)
     * 2. Authorizes caller (can_grant_access on the organization)
     * 3. Loads all policies where the user is principal within the org scope
     * 4. Deletes all matching policies from MongoDB
     * 5. Removes all corresponding tuples from OpenFGA
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the organization
     * - System flows running as the platform machine account cannot satisfy this
     *   check (the machine account holds no org-scoped grants by design) and must
     *   use bootstrapRevokeOrgAccess instead
     * Use Cases:
     * - Removing a member from an organization
     * - Offboarding a user from all org resources in one operation
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public com.google.protobuf.Empty revokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRevokeOrgAccessMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * &#64;internal
     * Exists because system flows execute the revoke as the platform machine
     * account, which by design holds no org-scoped grants. The system channel does
     * NOT bypass authorization — it authenticates as the machine account, which
     * can only satisfy platform-scoped permissions. revokeOrgAccess therefore
     * always fails with PERMISSION_DENIED on the system channel; this RPC is the
     * sanctioned path, mirroring how bootstrapPolicy is the system-path twin of
     * create (see https://github.com/stigmer/stigmer/issues/332).
     * The operation (identical to revokeOrgAccess after authorization):
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Loads all policies where the identity account is principal within the org
     *    scope, plus policies directly on the organization itself
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA (idempotent if none exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services (machine accounts)
     * Use Cases:
     * - Federated account deprovisioning (deprovisionFederatedAccount's revoke step)
     * - Any platform-driven offboarding that runs under system credentials
     * End-user member removal must use revokeOrgAccess, which checks
     * can_grant_access on the organization.
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public com.google.protobuf.Empty bootstrapRevokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getBootstrapRevokeOrgAccessMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service IamPolicyCommandController.
   * <pre>
   * IAM Policy Command Controller
   * This service manages the lifecycle of IAM policies in Stigmer.
   * IAM policies define access control rules by connecting three key elements:
   * - Principal: WHO gets access (user, team, etc.)
   * - Resource: WHAT is being accessed (any API resource)
   * - Relation: HOW they can access it (viewer, admin, user, etc.)
   * Under the hood, each IAM policy creates an OpenFGA tuple that enforces
   * the permission in the authorization system.
   * Common Use Cases:
   * - Granting users access to organizations
   * - Setting up team-based access control
   * - Managing fine-grained permissions on any resource
   * </pre>
   */
  public static final class IamPolicyCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<IamPolicyCommandControllerFutureStub> {
    private IamPolicyCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IamPolicyCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IamPolicyCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a new IAM policy
     * Creates a single IAM policy that grants a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
     * &#64;internal
     * The operation:
     * 1. Validates the input (principal, resource, relation are all valid)
     * 2. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 3. Creates the policy in the database with auto-generated ID and metadata
     * 4. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE being shared
     * - This ensures only resource owners/admins can grant access to their resources
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result:
     *   Created IamPolicy with auto-generated ID (e.g., "iamp_01HQ...")
     *   Alice can view (but not modify) the organization
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.IamPolicy> create(
        ai.stigmer.iam.iampolicy.v1.IamPolicySpec request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a single IAM policy by spec
     * Removes an existing IAM policy by matching the principal, resource, and relation.
     * This is a surgical operation — it removes one specific policy without affecting others.
     * &#64;internal
     * The operation:
     * 1. Finds the policy by matching principal+resource+relation
     * 2. Removes it from the database
     * 3. Deletes the corresponding tuple from OpenFGA
     * 4. If no matching policy exists, the operation is idempotent (no error)
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the RESOURCE referenced in the policy
     * Use Cases:
     * - Revoking a specific permission from a user
     * - Removing access after a team member leaves
     * - Cleaning up individual policies
     * Example:
     * Input:
     *   principal: {kind: "identity_account", id: "ia_alice-123"}
     *   resource: {kind: "organization", id: "org_demo-456"}
     *   relation: "viewer"
     * Result: The policy granting Alice viewer access to the organization is deleted
     * Input: IamPolicySpec identifying the policy to delete (principal, resource, relation)
     * Output: The deleted IamPolicy object (for audit/confirmation purposes)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.IamPolicy> delete(
        ai.stigmer.iam.iampolicy.v1.IamPolicySpec request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Bootstrap IAM policy during resource creation
     * Creates IAM policies during resource creation when standard authorization cannot work yet
     * because no tuples exist.
     * &#64;internal
     * Solves the chicken-and-egg problem where creating the first policy for a resource
     * requires authorization, but authorization requires that first policy.
     * The operation:
     * 1. Validates that caller has can_bootstrap_iam permission on platform:stigmer
     * 2. Validates the input (principal, resource, relation are all valid)
     * 3. Checks for duplicates (skips if the exact policy already exists, idempotent)
     * 4. Creates the policy in the database with auto-generated ID and metadata
     * 5. Writes the corresponding tuple to OpenFGA (where authorization is enforced)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only called by resource creation handlers running as machine accounts
     * Use Cases:
     * - Creating scope links (agent#organization&#64;organization:acme) during agent creation
     * - Creating owner relations (agent#owner&#64;identity_account:alice) during agent creation
     * - Establishing initial authorization tuples for any newly created resource
     * Example:
     * Input:
     *   principal: {kind: "organization", id: "org_demo-123"}
     *   resource: {kind: "agent", id: "agt_abc-456"}
     *   relation: "organization"
     * Result:
     *   Created IamPolicy establishing agent's organization scope
     *   Subsequent IAM policy operations can now use standard authorization
     * Note: After the bootstrap policies are created, subsequent IAM policy modifications
     * must use the standard 'create' RPC which requires 'can_grant_access' permission.
     * Input: IamPolicySpec containing principal, resource, and relation
     * Output: The created IamPolicy with generated ID and metadata
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.IamPolicy> bootstrapPolicy(
        ai.stigmer.iam.iampolicy.v1.IamPolicySpec request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getBootstrapPolicyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cleanup all IAM policies for a deleted resource.
     * Removes all IAM policies associated with a deleted resource.
     * &#64;internal
     * Performs bidirectional cleanup:
     * 1. Policies where resource is the TARGET (policies granting access TO this resource)
     * 2. Policies where resource is the PRINCIPAL (policies where this resource HAS access)
     * The operation:
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Finds all policies where resource_id appears (as principal OR resource)
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA
     * 5. Returns Empty (idempotent if no policies exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services
     * Use Cases:
     * - Resource deletion cleanup
     * - Preventing orphaned FGA tuples
     * - Maintaining authorization system integrity
     * Example:
     * Input: {kind: "organization", id: "org_demo-123"}
     * Result: All policies referencing org_demo-123 are deleted
     * Input: ApiResourceRef with resource kind and ID
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<com.google.protobuf.Empty> cleanupResourcePolicies(
        ai.stigmer.iam.iampolicy.v1.ApiResourceRef request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCleanupResourcePoliciesMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization.
     * Removes every IAM policy that grants the specified identity account access to
     * resources within the given organization, including policies on the organization
     * itself and on child resources (environments, agents, etc.).
     * &#64;internal
     * The operation:
     * 1. Validates the input (identity_account_id and organization_id are present)
     * 2. Authorizes caller (can_grant_access on the organization)
     * 3. Loads all policies where the user is principal within the org scope
     * 4. Deletes all matching policies from MongoDB
     * 5. Removes all corresponding tuples from OpenFGA
     * Authorization:
     * - Caller must have 'can_grant_access' permission on the organization
     * - System flows running as the platform machine account cannot satisfy this
     *   check (the machine account holds no org-scoped grants by design) and must
     *   use bootstrapRevokeOrgAccess instead
     * Use Cases:
     * - Removing a member from an organization
     * - Offboarding a user from all org resources in one operation
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<com.google.protobuf.Empty> revokeOrgAccess(
        ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRevokeOrgAccessMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Revoke all of a user's access to an organization via the system (bootstrap) path.
     * The system-flow twin of revokeOrgAccess: identical revocation behavior, but
     * authorized by can_bootstrap_iam on platform:stigmer instead of
     * can_grant_access on the organization.
     * &#64;internal
     * Exists because system flows execute the revoke as the platform machine
     * account, which by design holds no org-scoped grants. The system channel does
     * NOT bypass authorization — it authenticates as the machine account, which
     * can only satisfy platform-scoped permissions. revokeOrgAccess therefore
     * always fails with PERMISSION_DENIED on the system channel; this RPC is the
     * sanctioned path, mirroring how bootstrapPolicy is the system-path twin of
     * create (see https://github.com/stigmer/stigmer/issues/332).
     * The operation (identical to revokeOrgAccess after authorization):
     * 1. Validates can_bootstrap_iam permission on platform:stigmer
     * 2. Loads all policies where the identity account is principal within the org
     *    scope, plus policies directly on the organization itself
     * 3. Deletes all matching policies from MongoDB
     * 4. Removes all corresponding tuples from OpenFGA (idempotent if none exist)
     * Authorization:
     * - Caller must have 'can_bootstrap_iam' permission on platform:stigmer
     * - This is typically only granted to platform services (machine accounts)
     * Use Cases:
     * - Federated account deprovisioning (deprovisionFederatedAccount's revoke step)
     * - Any platform-driven offboarding that runs under system credentials
     * End-user member removal must use revokeOrgAccess, which checks
     * can_grant_access on the organization.
     * Input: RevokeOrgAccessInput with identity_account_id and organization_id
     * Output: Empty (google.protobuf.Empty)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<com.google.protobuf.Empty> bootstrapRevokeOrgAccess(
        ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getBootstrapRevokeOrgAccessMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_DELETE = 1;
  private static final int METHODID_BOOTSTRAP_POLICY = 2;
  private static final int METHODID_CLEANUP_RESOURCE_POLICIES = 3;
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
          serviceImpl.create((ai.stigmer.iam.iampolicy.v1.IamPolicySpec) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.iam.iampolicy.v1.IamPolicySpec) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy>) responseObserver);
          break;
        case METHODID_BOOTSTRAP_POLICY:
          serviceImpl.bootstrapPolicy((ai.stigmer.iam.iampolicy.v1.IamPolicySpec) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy>) responseObserver);
          break;
        case METHODID_CLEANUP_RESOURCE_POLICIES:
          serviceImpl.cleanupResourcePolicies((ai.stigmer.iam.iampolicy.v1.ApiResourceRef) request,
              (io.grpc.stub.StreamObserver<com.google.protobuf.Empty>) responseObserver);
          break;
        case METHODID_REVOKE_ORG_ACCESS:
          serviceImpl.revokeOrgAccess((ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput) request,
              (io.grpc.stub.StreamObserver<com.google.protobuf.Empty>) responseObserver);
          break;
        case METHODID_BOOTSTRAP_REVOKE_ORG_ACCESS:
          serviceImpl.bootstrapRevokeOrgAccess((ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput) request,
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
              ai.stigmer.iam.iampolicy.v1.IamPolicySpec,
              ai.stigmer.iam.iampolicy.v1.IamPolicy>(
                service, METHODID_CREATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.IamPolicySpec,
              ai.stigmer.iam.iampolicy.v1.IamPolicy>(
                service, METHODID_DELETE)))
        .addMethod(
          getBootstrapPolicyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.IamPolicySpec,
              ai.stigmer.iam.iampolicy.v1.IamPolicy>(
                service, METHODID_BOOTSTRAP_POLICY)))
        .addMethod(
          getCleanupResourcePoliciesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.ApiResourceRef,
              com.google.protobuf.Empty>(
                service, METHODID_CLEANUP_RESOURCE_POLICIES)))
        .addMethod(
          getRevokeOrgAccessMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput,
              com.google.protobuf.Empty>(
                service, METHODID_REVOKE_ORG_ACCESS)))
        .addMethod(
          getBootstrapRevokeOrgAccessMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput,
              com.google.protobuf.Empty>(
                service, METHODID_BOOTSTRAP_REVOKE_ORG_ACCESS)))
        .build();
  }

  private static abstract class IamPolicyCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    IamPolicyCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.iampolicy.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("IamPolicyCommandController");
    }
  }

  private static final class IamPolicyCommandControllerFileDescriptorSupplier
      extends IamPolicyCommandControllerBaseDescriptorSupplier {
    IamPolicyCommandControllerFileDescriptorSupplier() {}
  }

  private static final class IamPolicyCommandControllerMethodDescriptorSupplier
      extends IamPolicyCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    IamPolicyCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (IamPolicyCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new IamPolicyCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getBootstrapPolicyMethod())
              .addMethod(getCleanupResourcePoliciesMethod())
              .addMethod(getRevokeOrgAccessMethod())
              .addMethod(getBootstrapRevokeOrgAccessMethod())
              .build();
        }
      }
    }
    return result;
  }
}
