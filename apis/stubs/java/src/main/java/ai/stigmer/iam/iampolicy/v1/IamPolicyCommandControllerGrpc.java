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
 * An IAM policy is the recorded grant; the edition's authorizer enforces
 * it. The Enterprise and Cloud editions also mirror each policy to an
 * OpenFGA tuple for fine-grained checks.
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
   * An IAM policy is the recorded grant; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each policy to an
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
     * Create a new IAM policy
     * Creates a single IAM policy that grants a principal access to a resource with a specific relation.
     * This is the fundamental operation for establishing permissions.
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
     * </pre>
     */
    default void cleanupResourcePolicies(ai.stigmer.iam.iampolicy.v1.ApiResourceRef request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCleanupResourcePoliciesMethod(), responseObserver);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every IAM policy it holds on the organization's resources: what was
     * shared with it (agents, environments, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    default void revokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request,
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
   * An IAM policy is the recorded grant; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each policy to an
   * OpenFGA tuple for fine-grained checks.
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
   * An IAM policy is the recorded grant; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each policy to an
   * OpenFGA tuple for fine-grained checks.
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
     * </pre>
     */
    public void cleanupResourcePolicies(ai.stigmer.iam.iampolicy.v1.ApiResourceRef request,
        io.grpc.stub.StreamObserver<com.google.protobuf.Empty> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCleanupResourcePoliciesMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every IAM policy it holds on the organization's resources: what was
     * shared with it (agents, environments, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    public void revokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request,
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
   * An IAM policy is the recorded grant; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each policy to an
   * OpenFGA tuple for fine-grained checks.
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
     * </pre>
     */
    public com.google.protobuf.Empty cleanupResourcePolicies(ai.stigmer.iam.iampolicy.v1.ApiResourceRef request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCleanupResourcePoliciesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every IAM policy it holds on the organization's resources: what was
     * shared with it (agents, environments, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    public com.google.protobuf.Empty revokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request) throws io.grpc.StatusException {
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
   * An IAM policy is the recorded grant; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each policy to an
   * OpenFGA tuple for fine-grained checks.
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
     * </pre>
     */
    public com.google.protobuf.Empty cleanupResourcePolicies(ai.stigmer.iam.iampolicy.v1.ApiResourceRef request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCleanupResourcePoliciesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every IAM policy it holds on the organization's resources: what was
     * shared with it (agents, environments, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    public com.google.protobuf.Empty revokeOrgAccess(ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request) {
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
   * An IAM policy is the recorded grant; the edition's authorizer enforces
   * it. The Enterprise and Cloud editions also mirror each policy to an
   * OpenFGA tuple for fine-grained checks.
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
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<com.google.protobuf.Empty> cleanupResourcePolicies(
        ai.stigmer.iam.iampolicy.v1.ApiResourceRef request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCleanupResourcePoliciesMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Remove a person from an organization.
     * Removes every role the identity account holds on the organization, then
     * every IAM policy it holds on the organization's resources: what was
     * shared with it (agents, environments, sessions and the rest) and its
     * team memberships. From that moment it reaches nothing in the
     * organization. What it created stays with the organization and is still
     * recorded as its work; the authorization model admits a person to their
     * own work only while they hold a role in the organization, so it becomes
     * theirs again only if they are invited back. What was shared with them
     * does not come back.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<com.google.protobuf.Empty> revokeOrgAccess(
        ai.stigmer.iam.iampolicy.v1.RevokeOrgAccessInput request) {
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
