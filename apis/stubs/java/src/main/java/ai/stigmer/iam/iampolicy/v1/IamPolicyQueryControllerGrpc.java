package ai.stigmer.iam.iampolicy.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * IamPolicyQueryController handles read operations for IAM policies.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class IamPolicyQueryControllerGrpc {

  private IamPolicyQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.iampolicy.v1.IamPolicyQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicyId,
      ai.stigmer.iam.iampolicy.v1.IamPolicy> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.iam.iampolicy.v1.IamPolicyId.class,
      responseType = ai.stigmer.iam.iampolicy.v1.IamPolicy.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicyId,
      ai.stigmer.iam.iampolicy.v1.IamPolicy> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.IamPolicyId, ai.stigmer.iam.iampolicy.v1.IamPolicy> getGetMethod;
    if ((getGetMethod = IamPolicyQueryControllerGrpc.getGetMethod) == null) {
      synchronized (IamPolicyQueryControllerGrpc.class) {
        if ((getGetMethod = IamPolicyQueryControllerGrpc.getGetMethod) == null) {
          IamPolicyQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.IamPolicyId, ai.stigmer.iam.iampolicy.v1.IamPolicy>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.IamPolicyId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.IamPolicy.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput,
      ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> getCheckMyPermissionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "checkMyPermission",
      requestType = ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput.class,
      responseType = ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput,
      ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> getCheckMyPermissionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput, ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> getCheckMyPermissionMethod;
    if ((getCheckMyPermissionMethod = IamPolicyQueryControllerGrpc.getCheckMyPermissionMethod) == null) {
      synchronized (IamPolicyQueryControllerGrpc.class) {
        if ((getCheckMyPermissionMethod = IamPolicyQueryControllerGrpc.getCheckMyPermissionMethod) == null) {
          IamPolicyQueryControllerGrpc.getCheckMyPermissionMethod = getCheckMyPermissionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput, ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "checkMyPermission"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyQueryControllerMethodDescriptorSupplier("checkMyPermission"))
              .build();
        }
      }
    }
    return getCheckMyPermissionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput,
      ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> getCheckAuthorizationMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "checkAuthorization",
      requestType = ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput.class,
      responseType = ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput,
      ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> getCheckAuthorizationMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput, ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> getCheckAuthorizationMethod;
    if ((getCheckAuthorizationMethod = IamPolicyQueryControllerGrpc.getCheckAuthorizationMethod) == null) {
      synchronized (IamPolicyQueryControllerGrpc.class) {
        if ((getCheckAuthorizationMethod = IamPolicyQueryControllerGrpc.getCheckAuthorizationMethod) == null) {
          IamPolicyQueryControllerGrpc.getCheckAuthorizationMethod = getCheckAuthorizationMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput, ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "checkAuthorization"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyQueryControllerMethodDescriptorSupplier("checkAuthorization"))
              .build();
        }
      }
    }
    return getCheckAuthorizationMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput,
      ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList> getListAuthorizedResourceIdsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listAuthorizedResourceIds",
      requestType = ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput.class,
      responseType = ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput,
      ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList> getListAuthorizedResourceIdsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput, ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList> getListAuthorizedResourceIdsMethod;
    if ((getListAuthorizedResourceIdsMethod = IamPolicyQueryControllerGrpc.getListAuthorizedResourceIdsMethod) == null) {
      synchronized (IamPolicyQueryControllerGrpc.class) {
        if ((getListAuthorizedResourceIdsMethod = IamPolicyQueryControllerGrpc.getListAuthorizedResourceIdsMethod) == null) {
          IamPolicyQueryControllerGrpc.getListAuthorizedResourceIdsMethod = getListAuthorizedResourceIdsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput, ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listAuthorizedResourceIds"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyQueryControllerMethodDescriptorSupplier("listAuthorizedResourceIds"))
              .build();
        }
      }
    }
    return getListAuthorizedResourceIdsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput,
      ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList> getListAuthorizedPrincipalIdsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listAuthorizedPrincipalIds",
      requestType = ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput.class,
      responseType = ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput,
      ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList> getListAuthorizedPrincipalIdsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput, ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList> getListAuthorizedPrincipalIdsMethod;
    if ((getListAuthorizedPrincipalIdsMethod = IamPolicyQueryControllerGrpc.getListAuthorizedPrincipalIdsMethod) == null) {
      synchronized (IamPolicyQueryControllerGrpc.class) {
        if ((getListAuthorizedPrincipalIdsMethod = IamPolicyQueryControllerGrpc.getListAuthorizedPrincipalIdsMethod) == null) {
          IamPolicyQueryControllerGrpc.getListAuthorizedPrincipalIdsMethod = getListAuthorizedPrincipalIdsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput, ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listAuthorizedPrincipalIds"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyQueryControllerMethodDescriptorSupplier("listAuthorizedPrincipalIds"))
              .build();
        }
      }
    }
    return getListAuthorizedPrincipalIdsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput,
      ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList> getListResourceAccessByPrincipalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listResourceAccessByPrincipal",
      requestType = ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput.class,
      responseType = ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput,
      ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList> getListResourceAccessByPrincipalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput, ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList> getListResourceAccessByPrincipalMethod;
    if ((getListResourceAccessByPrincipalMethod = IamPolicyQueryControllerGrpc.getListResourceAccessByPrincipalMethod) == null) {
      synchronized (IamPolicyQueryControllerGrpc.class) {
        if ((getListResourceAccessByPrincipalMethod = IamPolicyQueryControllerGrpc.getListResourceAccessByPrincipalMethod) == null) {
          IamPolicyQueryControllerGrpc.getListResourceAccessByPrincipalMethod = getListResourceAccessByPrincipalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput, ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listResourceAccessByPrincipal"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyQueryControllerMethodDescriptorSupplier("listResourceAccessByPrincipal"))
              .build();
        }
      }
    }
    return getListResourceAccessByPrincipalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput,
      ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles> getGetPrincipalResourceRolesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getPrincipalResourceRoles",
      requestType = ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput.class,
      responseType = ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput,
      ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles> getGetPrincipalResourceRolesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput, ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles> getGetPrincipalResourceRolesMethod;
    if ((getGetPrincipalResourceRolesMethod = IamPolicyQueryControllerGrpc.getGetPrincipalResourceRolesMethod) == null) {
      synchronized (IamPolicyQueryControllerGrpc.class) {
        if ((getGetPrincipalResourceRolesMethod = IamPolicyQueryControllerGrpc.getGetPrincipalResourceRolesMethod) == null) {
          IamPolicyQueryControllerGrpc.getGetPrincipalResourceRolesMethod = getGetPrincipalResourceRolesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput, ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getPrincipalResourceRoles"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyQueryControllerMethodDescriptorSupplier("getPrincipalResourceRoles"))
              .build();
        }
      }
    }
    return getGetPrincipalResourceRolesMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput,
      ai.stigmer.iam.iampolicy.v1.PrincipalsCount> getGetPrincipalsCountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getPrincipalsCount",
      requestType = ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput.class,
      responseType = ai.stigmer.iam.iampolicy.v1.PrincipalsCount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput,
      ai.stigmer.iam.iampolicy.v1.PrincipalsCount> getGetPrincipalsCountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput, ai.stigmer.iam.iampolicy.v1.PrincipalsCount> getGetPrincipalsCountMethod;
    if ((getGetPrincipalsCountMethod = IamPolicyQueryControllerGrpc.getGetPrincipalsCountMethod) == null) {
      synchronized (IamPolicyQueryControllerGrpc.class) {
        if ((getGetPrincipalsCountMethod = IamPolicyQueryControllerGrpc.getGetPrincipalsCountMethod) == null) {
          IamPolicyQueryControllerGrpc.getGetPrincipalsCountMethod = getGetPrincipalsCountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput, ai.stigmer.iam.iampolicy.v1.PrincipalsCount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getPrincipalsCount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.iampolicy.v1.PrincipalsCount.getDefaultInstance()))
              .setSchemaDescriptor(new IamPolicyQueryControllerMethodDescriptorSupplier("getPrincipalsCount"))
              .build();
        }
      }
    }
    return getGetPrincipalsCountMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static IamPolicyQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IamPolicyQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IamPolicyQueryControllerStub>() {
        @java.lang.Override
        public IamPolicyQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IamPolicyQueryControllerStub(channel, callOptions);
        }
      };
    return IamPolicyQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static IamPolicyQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IamPolicyQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IamPolicyQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public IamPolicyQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IamPolicyQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return IamPolicyQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static IamPolicyQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IamPolicyQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IamPolicyQueryControllerBlockingStub>() {
        @java.lang.Override
        public IamPolicyQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IamPolicyQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return IamPolicyQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static IamPolicyQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<IamPolicyQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<IamPolicyQueryControllerFutureStub>() {
        @java.lang.Override
        public IamPolicyQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new IamPolicyQueryControllerFutureStub(channel, callOptions);
        }
      };
    return IamPolicyQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * IamPolicyQueryController handles read operations for IAM policies.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get an IAM policy by its unique identifier.
     * Returns the full IAM policy including its principal, resource, and relation binding.
     * &#64;internal
     * Authorization: Requires can_view_access permission.
     * </pre>
     */
    default void get(ai.stigmer.iam.iampolicy.v1.IamPolicyId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Check whether the AUTHENTICATED CALLER has a permission on a resource.
     * This is the self-check RPC for clients (web console, desktop, SDKs):
     * "Do I have permission Y on resource Z?"
     * The principal is always derived server-side from the authenticated token.
     * The input has no principal field by design — clients cannot name a
     * principal, so cross-principal permission probing is structurally
     * impossible (the Kubernetes SelfSubjectAccessReview pattern).
     * Use Cases:
     * - Pre-flight UI checks before showing buttons/actions
     * - Permission-gated rendering (PermissionGate components)
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization because authorizing this RPC via IAM would
     * recurse into IAM. Authentication is still required; the handler anchors
     * the FGA check to the caller's identity account.
     * </pre>
     */
    default void checkMyPermission(ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCheckMyPermissionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing IAM policies, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with policy spec and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization to avoid IAM-authorizing-IAM recursion.
     * The handler enforces principal trust instead: the caller must either BE
     * the principal being checked, or be a machine (system) account.
     * </pre>
     */
    default void checkAuthorization(ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCheckAuthorizationMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all resource IDs of a specific kind that a principal is authorized to access
     * This RPC answers: "What are all the [resource-kind] that [principal] can [relation] on?"
     * Essential for building permission-aware UIs and filtering resource lists.
     * Use Cases:
     * - Resource list filtering in dropdowns
     * - Permission-based navigation
     * - Bulk authorization checks
     * Input: ListAuthorizedResourceIdsInput with principal, resource_kind, and relation
     * Output: AuthorizedResourceIdsList containing all accessible resource IDs
     * </pre>
     */
    default void listAuthorizedResourceIds(ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListAuthorizedResourceIdsMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all principal IDs of a specific kind that are authorized to access a resource
     * This RPC answers: "What are all the [principal-kind] that have [relation] access on [resource]?"
     * Inverse of listAuthorizedResourceIds.
     * Use Cases:
     * - Resource access audit (who can access this?)
     * - Team discovery for resources
     * - Compliance and security audits
     * Input: ListAuthorizedPrincipalIdsInput with resource, principal_kind, and relation
     * Output: AuthorizedPrincipalIdsList containing all authorized principal IDs
     * </pre>
     */
    default void listAuthorizedPrincipalIds(ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListAuthorizedPrincipalIdsMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all principals and their roles on a resource, grouped by principal.
     * This RPC answers: "Who has access to this resource, and what roles do they have?"
     * Returns each principal with full display information and all their role grants,
     * optionally including roles inherited from parent resources.
     * Use Cases:
     * - Organization members page (show all users and their roles)
     * - Resource "Share" dialog (show who already has access)
     * - Access audit views
     * Input: ListResourceAccessInput with resource ref and include_inherited flag
     * Output: ResourceAccessByPrincipalList with PrincipalAccess entries
     * </pre>
     */
    default void listResourceAccessByPrincipal(ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListResourceAccessByPrincipalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get all roles a specific principal has on a specific resource.
     * This RPC answers: "What roles does [principal] have on [resource]?"
     * Returns role metadata (code, display name, description) for each assigned role.
     * Use Cases:
     * - Displaying a user's current role in a resource detail view
     * - Pre-populating role selectors when editing access
     * - Permission summary for a specific user-resource pair
     * Input: PrincipalResourceInput with principal and resource refs
     * Output: PrincipalResourceRoles with list of RoleInfo entries
     * </pre>
     */
    default void getPrincipalResourceRoles(ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetPrincipalResourceRolesMethod(), responseObserver);
    }

    /**
     * <pre>
     * Count distinct principals that have access to a resource.
     * This RPC answers: "How many [principal-kind] have access to this organization?"
     * Used for member count badges and summary statistics.
     * Use Cases:
     * - Organization members count badge in navigation
     * - Settings page member summary
     * Input: GetPrincipalsCountInput with org_id and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    default void getPrincipalsCount(ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.PrincipalsCount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetPrincipalsCountMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service IamPolicyQueryController.
   * <pre>
   * IamPolicyQueryController handles read operations for IAM policies.
   * </pre>
   */
  public static abstract class IamPolicyQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return IamPolicyQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service IamPolicyQueryController.
   * <pre>
   * IamPolicyQueryController handles read operations for IAM policies.
   * </pre>
   */
  public static final class IamPolicyQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<IamPolicyQueryControllerStub> {
    private IamPolicyQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IamPolicyQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IamPolicyQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an IAM policy by its unique identifier.
     * Returns the full IAM policy including its principal, resource, and relation binding.
     * &#64;internal
     * Authorization: Requires can_view_access permission.
     * </pre>
     */
    public void get(ai.stigmer.iam.iampolicy.v1.IamPolicyId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Check whether the AUTHENTICATED CALLER has a permission on a resource.
     * This is the self-check RPC for clients (web console, desktop, SDKs):
     * "Do I have permission Y on resource Z?"
     * The principal is always derived server-side from the authenticated token.
     * The input has no principal field by design — clients cannot name a
     * principal, so cross-principal permission probing is structurally
     * impossible (the Kubernetes SelfSubjectAccessReview pattern).
     * Use Cases:
     * - Pre-flight UI checks before showing buttons/actions
     * - Permission-gated rendering (PermissionGate components)
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization because authorizing this RPC via IAM would
     * recurse into IAM. Authentication is still required; the handler anchors
     * the FGA check to the caller's identity account.
     * </pre>
     */
    public void checkMyPermission(ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCheckMyPermissionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing IAM policies, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with policy spec and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization to avoid IAM-authorizing-IAM recursion.
     * The handler enforces principal trust instead: the caller must either BE
     * the principal being checked, or be a machine (system) account.
     * </pre>
     */
    public void checkAuthorization(ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCheckAuthorizationMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all resource IDs of a specific kind that a principal is authorized to access
     * This RPC answers: "What are all the [resource-kind] that [principal] can [relation] on?"
     * Essential for building permission-aware UIs and filtering resource lists.
     * Use Cases:
     * - Resource list filtering in dropdowns
     * - Permission-based navigation
     * - Bulk authorization checks
     * Input: ListAuthorizedResourceIdsInput with principal, resource_kind, and relation
     * Output: AuthorizedResourceIdsList containing all accessible resource IDs
     * </pre>
     */
    public void listAuthorizedResourceIds(ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListAuthorizedResourceIdsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all principal IDs of a specific kind that are authorized to access a resource
     * This RPC answers: "What are all the [principal-kind] that have [relation] access on [resource]?"
     * Inverse of listAuthorizedResourceIds.
     * Use Cases:
     * - Resource access audit (who can access this?)
     * - Team discovery for resources
     * - Compliance and security audits
     * Input: ListAuthorizedPrincipalIdsInput with resource, principal_kind, and relation
     * Output: AuthorizedPrincipalIdsList containing all authorized principal IDs
     * </pre>
     */
    public void listAuthorizedPrincipalIds(ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListAuthorizedPrincipalIdsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all principals and their roles on a resource, grouped by principal.
     * This RPC answers: "Who has access to this resource, and what roles do they have?"
     * Returns each principal with full display information and all their role grants,
     * optionally including roles inherited from parent resources.
     * Use Cases:
     * - Organization members page (show all users and their roles)
     * - Resource "Share" dialog (show who already has access)
     * - Access audit views
     * Input: ListResourceAccessInput with resource ref and include_inherited flag
     * Output: ResourceAccessByPrincipalList with PrincipalAccess entries
     * </pre>
     */
    public void listResourceAccessByPrincipal(ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListResourceAccessByPrincipalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get all roles a specific principal has on a specific resource.
     * This RPC answers: "What roles does [principal] have on [resource]?"
     * Returns role metadata (code, display name, description) for each assigned role.
     * Use Cases:
     * - Displaying a user's current role in a resource detail view
     * - Pre-populating role selectors when editing access
     * - Permission summary for a specific user-resource pair
     * Input: PrincipalResourceInput with principal and resource refs
     * Output: PrincipalResourceRoles with list of RoleInfo entries
     * </pre>
     */
    public void getPrincipalResourceRoles(ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetPrincipalResourceRolesMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Count distinct principals that have access to a resource.
     * This RPC answers: "How many [principal-kind] have access to this organization?"
     * Used for member count badges and summary statistics.
     * Use Cases:
     * - Organization members count badge in navigation
     * - Settings page member summary
     * Input: GetPrincipalsCountInput with org_id and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    public void getPrincipalsCount(ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.PrincipalsCount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetPrincipalsCountMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service IamPolicyQueryController.
   * <pre>
   * IamPolicyQueryController handles read operations for IAM policies.
   * </pre>
   */
  public static final class IamPolicyQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<IamPolicyQueryControllerBlockingV2Stub> {
    private IamPolicyQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IamPolicyQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IamPolicyQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an IAM policy by its unique identifier.
     * Returns the full IAM policy including its principal, resource, and relation binding.
     * &#64;internal
     * Authorization: Requires can_view_access permission.
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.IamPolicy get(ai.stigmer.iam.iampolicy.v1.IamPolicyId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Check whether the AUTHENTICATED CALLER has a permission on a resource.
     * This is the self-check RPC for clients (web console, desktop, SDKs):
     * "Do I have permission Y on resource Z?"
     * The principal is always derived server-side from the authenticated token.
     * The input has no principal field by design — clients cannot name a
     * principal, so cross-principal permission probing is structurally
     * impossible (the Kubernetes SelfSubjectAccessReview pattern).
     * Use Cases:
     * - Pre-flight UI checks before showing buttons/actions
     * - Permission-gated rendering (PermissionGate components)
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization because authorizing this RPC via IAM would
     * recurse into IAM. Authentication is still required; the handler anchors
     * the FGA check to the caller's identity account.
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult checkMyPermission(ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCheckMyPermissionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing IAM policies, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with policy spec and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization to avoid IAM-authorizing-IAM recursion.
     * The handler enforces principal trust instead: the caller must either BE
     * the principal being checked, or be a machine (system) account.
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult checkAuthorization(ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCheckAuthorizationMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all resource IDs of a specific kind that a principal is authorized to access
     * This RPC answers: "What are all the [resource-kind] that [principal] can [relation] on?"
     * Essential for building permission-aware UIs and filtering resource lists.
     * Use Cases:
     * - Resource list filtering in dropdowns
     * - Permission-based navigation
     * - Bulk authorization checks
     * Input: ListAuthorizedResourceIdsInput with principal, resource_kind, and relation
     * Output: AuthorizedResourceIdsList containing all accessible resource IDs
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList listAuthorizedResourceIds(ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListAuthorizedResourceIdsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all principal IDs of a specific kind that are authorized to access a resource
     * This RPC answers: "What are all the [principal-kind] that have [relation] access on [resource]?"
     * Inverse of listAuthorizedResourceIds.
     * Use Cases:
     * - Resource access audit (who can access this?)
     * - Team discovery for resources
     * - Compliance and security audits
     * Input: ListAuthorizedPrincipalIdsInput with resource, principal_kind, and relation
     * Output: AuthorizedPrincipalIdsList containing all authorized principal IDs
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList listAuthorizedPrincipalIds(ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListAuthorizedPrincipalIdsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all principals and their roles on a resource, grouped by principal.
     * This RPC answers: "Who has access to this resource, and what roles do they have?"
     * Returns each principal with full display information and all their role grants,
     * optionally including roles inherited from parent resources.
     * Use Cases:
     * - Organization members page (show all users and their roles)
     * - Resource "Share" dialog (show who already has access)
     * - Access audit views
     * Input: ListResourceAccessInput with resource ref and include_inherited flag
     * Output: ResourceAccessByPrincipalList with PrincipalAccess entries
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList listResourceAccessByPrincipal(ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListResourceAccessByPrincipalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all roles a specific principal has on a specific resource.
     * This RPC answers: "What roles does [principal] have on [resource]?"
     * Returns role metadata (code, display name, description) for each assigned role.
     * Use Cases:
     * - Displaying a user's current role in a resource detail view
     * - Pre-populating role selectors when editing access
     * - Permission summary for a specific user-resource pair
     * Input: PrincipalResourceInput with principal and resource refs
     * Output: PrincipalResourceRoles with list of RoleInfo entries
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles getPrincipalResourceRoles(ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetPrincipalResourceRolesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Count distinct principals that have access to a resource.
     * This RPC answers: "How many [principal-kind] have access to this organization?"
     * Used for member count badges and summary statistics.
     * Use Cases:
     * - Organization members count badge in navigation
     * - Settings page member summary
     * Input: GetPrincipalsCountInput with org_id and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.PrincipalsCount getPrincipalsCount(ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetPrincipalsCountMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service IamPolicyQueryController.
   * <pre>
   * IamPolicyQueryController handles read operations for IAM policies.
   * </pre>
   */
  public static final class IamPolicyQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<IamPolicyQueryControllerBlockingStub> {
    private IamPolicyQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IamPolicyQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IamPolicyQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an IAM policy by its unique identifier.
     * Returns the full IAM policy including its principal, resource, and relation binding.
     * &#64;internal
     * Authorization: Requires can_view_access permission.
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.IamPolicy get(ai.stigmer.iam.iampolicy.v1.IamPolicyId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Check whether the AUTHENTICATED CALLER has a permission on a resource.
     * This is the self-check RPC for clients (web console, desktop, SDKs):
     * "Do I have permission Y on resource Z?"
     * The principal is always derived server-side from the authenticated token.
     * The input has no principal field by design — clients cannot name a
     * principal, so cross-principal permission probing is structurally
     * impossible (the Kubernetes SelfSubjectAccessReview pattern).
     * Use Cases:
     * - Pre-flight UI checks before showing buttons/actions
     * - Permission-gated rendering (PermissionGate components)
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization because authorizing this RPC via IAM would
     * recurse into IAM. Authentication is still required; the handler anchors
     * the FGA check to the caller's identity account.
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult checkMyPermission(ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCheckMyPermissionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing IAM policies, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with policy spec and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization to avoid IAM-authorizing-IAM recursion.
     * The handler enforces principal trust instead: the caller must either BE
     * the principal being checked, or be a machine (system) account.
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult checkAuthorization(ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCheckAuthorizationMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all resource IDs of a specific kind that a principal is authorized to access
     * This RPC answers: "What are all the [resource-kind] that [principal] can [relation] on?"
     * Essential for building permission-aware UIs and filtering resource lists.
     * Use Cases:
     * - Resource list filtering in dropdowns
     * - Permission-based navigation
     * - Bulk authorization checks
     * Input: ListAuthorizedResourceIdsInput with principal, resource_kind, and relation
     * Output: AuthorizedResourceIdsList containing all accessible resource IDs
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList listAuthorizedResourceIds(ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListAuthorizedResourceIdsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all principal IDs of a specific kind that are authorized to access a resource
     * This RPC answers: "What are all the [principal-kind] that have [relation] access on [resource]?"
     * Inverse of listAuthorizedResourceIds.
     * Use Cases:
     * - Resource access audit (who can access this?)
     * - Team discovery for resources
     * - Compliance and security audits
     * Input: ListAuthorizedPrincipalIdsInput with resource, principal_kind, and relation
     * Output: AuthorizedPrincipalIdsList containing all authorized principal IDs
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList listAuthorizedPrincipalIds(ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListAuthorizedPrincipalIdsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all principals and their roles on a resource, grouped by principal.
     * This RPC answers: "Who has access to this resource, and what roles do they have?"
     * Returns each principal with full display information and all their role grants,
     * optionally including roles inherited from parent resources.
     * Use Cases:
     * - Organization members page (show all users and their roles)
     * - Resource "Share" dialog (show who already has access)
     * - Access audit views
     * Input: ListResourceAccessInput with resource ref and include_inherited flag
     * Output: ResourceAccessByPrincipalList with PrincipalAccess entries
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList listResourceAccessByPrincipal(ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListResourceAccessByPrincipalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get all roles a specific principal has on a specific resource.
     * This RPC answers: "What roles does [principal] have on [resource]?"
     * Returns role metadata (code, display name, description) for each assigned role.
     * Use Cases:
     * - Displaying a user's current role in a resource detail view
     * - Pre-populating role selectors when editing access
     * - Permission summary for a specific user-resource pair
     * Input: PrincipalResourceInput with principal and resource refs
     * Output: PrincipalResourceRoles with list of RoleInfo entries
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles getPrincipalResourceRoles(ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetPrincipalResourceRolesMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Count distinct principals that have access to a resource.
     * This RPC answers: "How many [principal-kind] have access to this organization?"
     * Used for member count badges and summary statistics.
     * Use Cases:
     * - Organization members count badge in navigation
     * - Settings page member summary
     * Input: GetPrincipalsCountInput with org_id and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    public ai.stigmer.iam.iampolicy.v1.PrincipalsCount getPrincipalsCount(ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetPrincipalsCountMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service IamPolicyQueryController.
   * <pre>
   * IamPolicyQueryController handles read operations for IAM policies.
   * </pre>
   */
  public static final class IamPolicyQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<IamPolicyQueryControllerFutureStub> {
    private IamPolicyQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected IamPolicyQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new IamPolicyQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get an IAM policy by its unique identifier.
     * Returns the full IAM policy including its principal, resource, and relation binding.
     * &#64;internal
     * Authorization: Requires can_view_access permission.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.IamPolicy> get(
        ai.stigmer.iam.iampolicy.v1.IamPolicyId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Check whether the AUTHENTICATED CALLER has a permission on a resource.
     * This is the self-check RPC for clients (web console, desktop, SDKs):
     * "Do I have permission Y on resource Z?"
     * The principal is always derived server-side from the authenticated token.
     * The input has no principal field by design — clients cannot name a
     * principal, so cross-principal permission probing is structurally
     * impossible (the Kubernetes SelfSubjectAccessReview pattern).
     * Use Cases:
     * - Pre-flight UI checks before showing buttons/actions
     * - Permission-gated rendering (PermissionGate components)
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization because authorizing this RPC via IAM would
     * recurse into IAM. Authentication is still required; the handler anchors
     * the FGA check to the caller's identity account.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> checkMyPermission(
        ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCheckMyPermissionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing IAM policies, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with policy spec and optional contextual policies
     * Output: CheckAuthorizationResult with is_authorized boolean
     * &#64;internal
     * Skips standard authorization to avoid IAM-authorizing-IAM recursion.
     * The handler enforces principal trust instead: the caller must either BE
     * the principal being checked, or be a machine (system) account.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult> checkAuthorization(
        ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCheckAuthorizationMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all resource IDs of a specific kind that a principal is authorized to access
     * This RPC answers: "What are all the [resource-kind] that [principal] can [relation] on?"
     * Essential for building permission-aware UIs and filtering resource lists.
     * Use Cases:
     * - Resource list filtering in dropdowns
     * - Permission-based navigation
     * - Bulk authorization checks
     * Input: ListAuthorizedResourceIdsInput with principal, resource_kind, and relation
     * Output: AuthorizedResourceIdsList containing all accessible resource IDs
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList> listAuthorizedResourceIds(
        ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListAuthorizedResourceIdsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all principal IDs of a specific kind that are authorized to access a resource
     * This RPC answers: "What are all the [principal-kind] that have [relation] access on [resource]?"
     * Inverse of listAuthorizedResourceIds.
     * Use Cases:
     * - Resource access audit (who can access this?)
     * - Team discovery for resources
     * - Compliance and security audits
     * Input: ListAuthorizedPrincipalIdsInput with resource, principal_kind, and relation
     * Output: AuthorizedPrincipalIdsList containing all authorized principal IDs
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList> listAuthorizedPrincipalIds(
        ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListAuthorizedPrincipalIdsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all principals and their roles on a resource, grouped by principal.
     * This RPC answers: "Who has access to this resource, and what roles do they have?"
     * Returns each principal with full display information and all their role grants,
     * optionally including roles inherited from parent resources.
     * Use Cases:
     * - Organization members page (show all users and their roles)
     * - Resource "Share" dialog (show who already has access)
     * - Access audit views
     * Input: ListResourceAccessInput with resource ref and include_inherited flag
     * Output: ResourceAccessByPrincipalList with PrincipalAccess entries
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList> listResourceAccessByPrincipal(
        ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListResourceAccessByPrincipalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get all roles a specific principal has on a specific resource.
     * This RPC answers: "What roles does [principal] have on [resource]?"
     * Returns role metadata (code, display name, description) for each assigned role.
     * Use Cases:
     * - Displaying a user's current role in a resource detail view
     * - Pre-populating role selectors when editing access
     * - Permission summary for a specific user-resource pair
     * Input: PrincipalResourceInput with principal and resource refs
     * Output: PrincipalResourceRoles with list of RoleInfo entries
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles> getPrincipalResourceRoles(
        ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetPrincipalResourceRolesMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Count distinct principals that have access to a resource.
     * This RPC answers: "How many [principal-kind] have access to this organization?"
     * Used for member count badges and summary statistics.
     * Use Cases:
     * - Organization members count badge in navigation
     * - Settings page member summary
     * Input: GetPrincipalsCountInput with org_id and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.iampolicy.v1.PrincipalsCount> getPrincipalsCount(
        ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetPrincipalsCountMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_CHECK_MY_PERMISSION = 1;
  private static final int METHODID_CHECK_AUTHORIZATION = 2;
  private static final int METHODID_LIST_AUTHORIZED_RESOURCE_IDS = 3;
  private static final int METHODID_LIST_AUTHORIZED_PRINCIPAL_IDS = 4;
  private static final int METHODID_LIST_RESOURCE_ACCESS_BY_PRINCIPAL = 5;
  private static final int METHODID_GET_PRINCIPAL_RESOURCE_ROLES = 6;
  private static final int METHODID_GET_PRINCIPALS_COUNT = 7;

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
          serviceImpl.get((ai.stigmer.iam.iampolicy.v1.IamPolicyId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.IamPolicy>) responseObserver);
          break;
        case METHODID_CHECK_MY_PERMISSION:
          serviceImpl.checkMyPermission((ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult>) responseObserver);
          break;
        case METHODID_CHECK_AUTHORIZATION:
          serviceImpl.checkAuthorization((ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult>) responseObserver);
          break;
        case METHODID_LIST_AUTHORIZED_RESOURCE_IDS:
          serviceImpl.listAuthorizedResourceIds((ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList>) responseObserver);
          break;
        case METHODID_LIST_AUTHORIZED_PRINCIPAL_IDS:
          serviceImpl.listAuthorizedPrincipalIds((ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList>) responseObserver);
          break;
        case METHODID_LIST_RESOURCE_ACCESS_BY_PRINCIPAL:
          serviceImpl.listResourceAccessByPrincipal((ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList>) responseObserver);
          break;
        case METHODID_GET_PRINCIPAL_RESOURCE_ROLES:
          serviceImpl.getPrincipalResourceRoles((ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles>) responseObserver);
          break;
        case METHODID_GET_PRINCIPALS_COUNT:
          serviceImpl.getPrincipalsCount((ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.iampolicy.v1.PrincipalsCount>) responseObserver);
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
              ai.stigmer.iam.iampolicy.v1.IamPolicyId,
              ai.stigmer.iam.iampolicy.v1.IamPolicy>(
                service, METHODID_GET)))
        .addMethod(
          getCheckMyPermissionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.CheckMyPermissionInput,
              ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult>(
                service, METHODID_CHECK_MY_PERMISSION)))
        .addMethod(
          getCheckAuthorizationMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.CheckAuthorizationInput,
              ai.stigmer.iam.iampolicy.v1.CheckAuthorizationResult>(
                service, METHODID_CHECK_AUTHORIZATION)))
        .addMethod(
          getListAuthorizedResourceIdsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.ListAuthorizedResourceIdsInput,
              ai.stigmer.iam.iampolicy.v1.AuthorizedResourceIdsList>(
                service, METHODID_LIST_AUTHORIZED_RESOURCE_IDS)))
        .addMethod(
          getListAuthorizedPrincipalIdsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.ListAuthorizedPrincipalIdsInput,
              ai.stigmer.iam.iampolicy.v1.AuthorizedPrincipalIdsList>(
                service, METHODID_LIST_AUTHORIZED_PRINCIPAL_IDS)))
        .addMethod(
          getListResourceAccessByPrincipalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.ListResourceAccessInput,
              ai.stigmer.iam.iampolicy.v1.ResourceAccessByPrincipalList>(
                service, METHODID_LIST_RESOURCE_ACCESS_BY_PRINCIPAL)))
        .addMethod(
          getGetPrincipalResourceRolesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.PrincipalResourceInput,
              ai.stigmer.iam.iampolicy.v1.PrincipalResourceRoles>(
                service, METHODID_GET_PRINCIPAL_RESOURCE_ROLES)))
        .addMethod(
          getGetPrincipalsCountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.iampolicy.v1.GetPrincipalsCountInput,
              ai.stigmer.iam.iampolicy.v1.PrincipalsCount>(
                service, METHODID_GET_PRINCIPALS_COUNT)))
        .build();
  }

  private static abstract class IamPolicyQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    IamPolicyQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.iampolicy.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("IamPolicyQueryController");
    }
  }

  private static final class IamPolicyQueryControllerFileDescriptorSupplier
      extends IamPolicyQueryControllerBaseDescriptorSupplier {
    IamPolicyQueryControllerFileDescriptorSupplier() {}
  }

  private static final class IamPolicyQueryControllerMethodDescriptorSupplier
      extends IamPolicyQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    IamPolicyQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (IamPolicyQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new IamPolicyQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getCheckMyPermissionMethod())
              .addMethod(getCheckAuthorizationMethod())
              .addMethod(getListAuthorizedResourceIdsMethod())
              .addMethod(getListAuthorizedPrincipalIdsMethod())
              .addMethod(getListResourceAccessByPrincipalMethod())
              .addMethod(getGetPrincipalResourceRolesMethod())
              .addMethod(getGetPrincipalsCountMethod())
              .build();
        }
      }
    }
    return result;
  }
}
