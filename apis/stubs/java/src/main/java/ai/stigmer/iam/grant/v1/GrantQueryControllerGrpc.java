package ai.stigmer.iam.grant.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * GrantQueryController reads grants and answers what they allow.
 * Three of its RPCs read grant rows (get, listResourceAccessByPrincipal and
 * listAccessHistory); the others are checks and lookups over what the
 * grants and the authorization model together let a principal do. The checks
 * live beside the grants they are answered from, as OpenFGA's Check sits
 * beside its Write and Google Cloud's testIamPermissions beside its IAM
 * policies.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class GrantQueryControllerGrpc {

  private GrantQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.iam.grant.v1.GrantQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantId,
      ai.stigmer.iam.grant.v1.Grant> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.iam.grant.v1.GrantId.class,
      responseType = ai.stigmer.iam.grant.v1.Grant.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantId,
      ai.stigmer.iam.grant.v1.Grant> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GrantId, ai.stigmer.iam.grant.v1.Grant> getGetMethod;
    if ((getGetMethod = GrantQueryControllerGrpc.getGetMethod) == null) {
      synchronized (GrantQueryControllerGrpc.class) {
        if ((getGetMethod = GrantQueryControllerGrpc.getGetMethod) == null) {
          GrantQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.GrantId, ai.stigmer.iam.grant.v1.Grant>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.GrantId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.Grant.getDefaultInstance()))
              .setSchemaDescriptor(new GrantQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.CheckMyPermissionInput,
      ai.stigmer.iam.grant.v1.CheckAuthorizationResult> getCheckMyPermissionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "checkMyPermission",
      requestType = ai.stigmer.iam.grant.v1.CheckMyPermissionInput.class,
      responseType = ai.stigmer.iam.grant.v1.CheckAuthorizationResult.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.CheckMyPermissionInput,
      ai.stigmer.iam.grant.v1.CheckAuthorizationResult> getCheckMyPermissionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.CheckMyPermissionInput, ai.stigmer.iam.grant.v1.CheckAuthorizationResult> getCheckMyPermissionMethod;
    if ((getCheckMyPermissionMethod = GrantQueryControllerGrpc.getCheckMyPermissionMethod) == null) {
      synchronized (GrantQueryControllerGrpc.class) {
        if ((getCheckMyPermissionMethod = GrantQueryControllerGrpc.getCheckMyPermissionMethod) == null) {
          GrantQueryControllerGrpc.getCheckMyPermissionMethod = getCheckMyPermissionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.CheckMyPermissionInput, ai.stigmer.iam.grant.v1.CheckAuthorizationResult>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "checkMyPermission"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.CheckMyPermissionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.CheckAuthorizationResult.getDefaultInstance()))
              .setSchemaDescriptor(new GrantQueryControllerMethodDescriptorSupplier("checkMyPermission"))
              .build();
        }
      }
    }
    return getCheckMyPermissionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.CheckAuthorizationInput,
      ai.stigmer.iam.grant.v1.CheckAuthorizationResult> getCheckAuthorizationMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "checkAuthorization",
      requestType = ai.stigmer.iam.grant.v1.CheckAuthorizationInput.class,
      responseType = ai.stigmer.iam.grant.v1.CheckAuthorizationResult.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.CheckAuthorizationInput,
      ai.stigmer.iam.grant.v1.CheckAuthorizationResult> getCheckAuthorizationMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.CheckAuthorizationInput, ai.stigmer.iam.grant.v1.CheckAuthorizationResult> getCheckAuthorizationMethod;
    if ((getCheckAuthorizationMethod = GrantQueryControllerGrpc.getCheckAuthorizationMethod) == null) {
      synchronized (GrantQueryControllerGrpc.class) {
        if ((getCheckAuthorizationMethod = GrantQueryControllerGrpc.getCheckAuthorizationMethod) == null) {
          GrantQueryControllerGrpc.getCheckAuthorizationMethod = getCheckAuthorizationMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.CheckAuthorizationInput, ai.stigmer.iam.grant.v1.CheckAuthorizationResult>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "checkAuthorization"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.CheckAuthorizationInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.CheckAuthorizationResult.getDefaultInstance()))
              .setSchemaDescriptor(new GrantQueryControllerMethodDescriptorSupplier("checkAuthorization"))
              .build();
        }
      }
    }
    return getCheckAuthorizationMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput,
      ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList> getListAuthorizedResourceIdsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listAuthorizedResourceIds",
      requestType = ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput.class,
      responseType = ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput,
      ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList> getListAuthorizedResourceIdsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput, ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList> getListAuthorizedResourceIdsMethod;
    if ((getListAuthorizedResourceIdsMethod = GrantQueryControllerGrpc.getListAuthorizedResourceIdsMethod) == null) {
      synchronized (GrantQueryControllerGrpc.class) {
        if ((getListAuthorizedResourceIdsMethod = GrantQueryControllerGrpc.getListAuthorizedResourceIdsMethod) == null) {
          GrantQueryControllerGrpc.getListAuthorizedResourceIdsMethod = getListAuthorizedResourceIdsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput, ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listAuthorizedResourceIds"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList.getDefaultInstance()))
              .setSchemaDescriptor(new GrantQueryControllerMethodDescriptorSupplier("listAuthorizedResourceIds"))
              .build();
        }
      }
    }
    return getListAuthorizedResourceIdsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput,
      ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList> getListAuthorizedPrincipalIdsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listAuthorizedPrincipalIds",
      requestType = ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput.class,
      responseType = ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput,
      ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList> getListAuthorizedPrincipalIdsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput, ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList> getListAuthorizedPrincipalIdsMethod;
    if ((getListAuthorizedPrincipalIdsMethod = GrantQueryControllerGrpc.getListAuthorizedPrincipalIdsMethod) == null) {
      synchronized (GrantQueryControllerGrpc.class) {
        if ((getListAuthorizedPrincipalIdsMethod = GrantQueryControllerGrpc.getListAuthorizedPrincipalIdsMethod) == null) {
          GrantQueryControllerGrpc.getListAuthorizedPrincipalIdsMethod = getListAuthorizedPrincipalIdsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput, ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listAuthorizedPrincipalIds"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList.getDefaultInstance()))
              .setSchemaDescriptor(new GrantQueryControllerMethodDescriptorSupplier("listAuthorizedPrincipalIds"))
              .build();
        }
      }
    }
    return getListAuthorizedPrincipalIdsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListResourceAccessInput,
      ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList> getListResourceAccessByPrincipalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listResourceAccessByPrincipal",
      requestType = ai.stigmer.iam.grant.v1.ListResourceAccessInput.class,
      responseType = ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListResourceAccessInput,
      ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList> getListResourceAccessByPrincipalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListResourceAccessInput, ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList> getListResourceAccessByPrincipalMethod;
    if ((getListResourceAccessByPrincipalMethod = GrantQueryControllerGrpc.getListResourceAccessByPrincipalMethod) == null) {
      synchronized (GrantQueryControllerGrpc.class) {
        if ((getListResourceAccessByPrincipalMethod = GrantQueryControllerGrpc.getListResourceAccessByPrincipalMethod) == null) {
          GrantQueryControllerGrpc.getListResourceAccessByPrincipalMethod = getListResourceAccessByPrincipalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.ListResourceAccessInput, ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listResourceAccessByPrincipal"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.ListResourceAccessInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList.getDefaultInstance()))
              .setSchemaDescriptor(new GrantQueryControllerMethodDescriptorSupplier("listResourceAccessByPrincipal"))
              .build();
        }
      }
    }
    return getListResourceAccessByPrincipalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.PrincipalResourceInput,
      ai.stigmer.iam.grant.v1.PrincipalResourceRoles> getGetPrincipalResourceRolesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getPrincipalResourceRoles",
      requestType = ai.stigmer.iam.grant.v1.PrincipalResourceInput.class,
      responseType = ai.stigmer.iam.grant.v1.PrincipalResourceRoles.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.PrincipalResourceInput,
      ai.stigmer.iam.grant.v1.PrincipalResourceRoles> getGetPrincipalResourceRolesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.PrincipalResourceInput, ai.stigmer.iam.grant.v1.PrincipalResourceRoles> getGetPrincipalResourceRolesMethod;
    if ((getGetPrincipalResourceRolesMethod = GrantQueryControllerGrpc.getGetPrincipalResourceRolesMethod) == null) {
      synchronized (GrantQueryControllerGrpc.class) {
        if ((getGetPrincipalResourceRolesMethod = GrantQueryControllerGrpc.getGetPrincipalResourceRolesMethod) == null) {
          GrantQueryControllerGrpc.getGetPrincipalResourceRolesMethod = getGetPrincipalResourceRolesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.PrincipalResourceInput, ai.stigmer.iam.grant.v1.PrincipalResourceRoles>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getPrincipalResourceRoles"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.PrincipalResourceInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.PrincipalResourceRoles.getDefaultInstance()))
              .setSchemaDescriptor(new GrantQueryControllerMethodDescriptorSupplier("getPrincipalResourceRoles"))
              .build();
        }
      }
    }
    return getGetPrincipalResourceRolesMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GetPrincipalsCountInput,
      ai.stigmer.iam.grant.v1.PrincipalsCount> getGetPrincipalsCountMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getPrincipalsCount",
      requestType = ai.stigmer.iam.grant.v1.GetPrincipalsCountInput.class,
      responseType = ai.stigmer.iam.grant.v1.PrincipalsCount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GetPrincipalsCountInput,
      ai.stigmer.iam.grant.v1.PrincipalsCount> getGetPrincipalsCountMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.GetPrincipalsCountInput, ai.stigmer.iam.grant.v1.PrincipalsCount> getGetPrincipalsCountMethod;
    if ((getGetPrincipalsCountMethod = GrantQueryControllerGrpc.getGetPrincipalsCountMethod) == null) {
      synchronized (GrantQueryControllerGrpc.class) {
        if ((getGetPrincipalsCountMethod = GrantQueryControllerGrpc.getGetPrincipalsCountMethod) == null) {
          GrantQueryControllerGrpc.getGetPrincipalsCountMethod = getGetPrincipalsCountMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.GetPrincipalsCountInput, ai.stigmer.iam.grant.v1.PrincipalsCount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getPrincipalsCount"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.GetPrincipalsCountInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.PrincipalsCount.getDefaultInstance()))
              .setSchemaDescriptor(new GrantQueryControllerMethodDescriptorSupplier("getPrincipalsCount"))
              .build();
        }
      }
    }
    return getGetPrincipalsCountMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListAccessHistoryInput,
      ai.stigmer.iam.grant.v1.AccessHistoryPage> getListAccessHistoryMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listAccessHistory",
      requestType = ai.stigmer.iam.grant.v1.ListAccessHistoryInput.class,
      responseType = ai.stigmer.iam.grant.v1.AccessHistoryPage.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListAccessHistoryInput,
      ai.stigmer.iam.grant.v1.AccessHistoryPage> getListAccessHistoryMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.iam.grant.v1.ListAccessHistoryInput, ai.stigmer.iam.grant.v1.AccessHistoryPage> getListAccessHistoryMethod;
    if ((getListAccessHistoryMethod = GrantQueryControllerGrpc.getListAccessHistoryMethod) == null) {
      synchronized (GrantQueryControllerGrpc.class) {
        if ((getListAccessHistoryMethod = GrantQueryControllerGrpc.getListAccessHistoryMethod) == null) {
          GrantQueryControllerGrpc.getListAccessHistoryMethod = getListAccessHistoryMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.iam.grant.v1.ListAccessHistoryInput, ai.stigmer.iam.grant.v1.AccessHistoryPage>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listAccessHistory"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.ListAccessHistoryInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.iam.grant.v1.AccessHistoryPage.getDefaultInstance()))
              .setSchemaDescriptor(new GrantQueryControllerMethodDescriptorSupplier("listAccessHistory"))
              .build();
        }
      }
    }
    return getListAccessHistoryMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static GrantQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GrantQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GrantQueryControllerStub>() {
        @java.lang.Override
        public GrantQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GrantQueryControllerStub(channel, callOptions);
        }
      };
    return GrantQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static GrantQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GrantQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GrantQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public GrantQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GrantQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return GrantQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static GrantQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GrantQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GrantQueryControllerBlockingStub>() {
        @java.lang.Override
        public GrantQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GrantQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return GrantQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static GrantQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<GrantQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<GrantQueryControllerFutureStub>() {
        @java.lang.Override
        public GrantQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new GrantQueryControllerFutureStub(channel, callOptions);
        }
      };
    return GrantQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * GrantQueryController reads grants and answers what they allow.
   * Three of its RPCs read grant rows (get, listResourceAccessByPrincipal and
   * listAccessHistory); the others are checks and lookups over what the
   * grants and the authorization model together let a principal do. The checks
   * live beside the grants they are answered from, as OpenFGA's Check sits
   * beside its Write and Google Cloud's testIamPermissions beside its IAM
   * policies.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a grant by its unique identifier.
     * Returns the full grant including its principal, resource, and relation binding.
     * </pre>
     */
    default void get(ai.stigmer.iam.grant.v1.GrantId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant> responseObserver) {
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
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    default void checkMyPermission(ai.stigmer.iam.grant.v1.CheckMyPermissionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.CheckAuthorizationResult> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCheckMyPermissionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing grants, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with grant spec and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    default void checkAuthorization(ai.stigmer.iam.grant.v1.CheckAuthorizationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.CheckAuthorizationResult> responseObserver) {
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
    default void listAuthorizedResourceIds(ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList> responseObserver) {
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
    default void listAuthorizedPrincipalIds(ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList> responseObserver) {
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
    default void listResourceAccessByPrincipal(ai.stigmer.iam.grant.v1.ListResourceAccessInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList> responseObserver) {
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
    default void getPrincipalResourceRoles(ai.stigmer.iam.grant.v1.PrincipalResourceInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.PrincipalResourceRoles> responseObserver) {
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
     * Input: GetPrincipalsCountInput with org and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    default void getPrincipalsCount(ai.stigmer.iam.grant.v1.GetPrincipalsCountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.PrincipalsCount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetPrincipalsCountMethod(), responseObserver);
    }

    /**
     * <pre>
     * List an organization's access history: every time someone was given
     * or lost access to the organization or to a resource in it, who did it,
     * why, and when.
     * Without after_sequence the entries come newest first, for people
     * reading what happened lately. With after_sequence they come oldest
     * first, starting just after that entry, for a tool that keeps its own
     * copy: it asks for what came after the last entry it holds. Each
     * organization numbers its entries from 1 in the order they happened,
     * with no gaps above the oldest kept entry, so a reader that resumes
     * after entry N never misses one the server still keeps.
     * A server may keep the history for a limited time, set by its operator.
     * It then removes the oldest entries first and never reuses a number:
     * every page says how many days the server keeps the history
     * (retention_days, 0 for good) and the oldest number it still holds
     * (oldest_sequence), so a tool can tell entries that were removed from
     * entries it missed.
     * Only the organization's owners and administrators may read it, and a
     * parent organization's administrators for a child, since they are
     * administrators in every child. Whoever may read it reads all of it. The
     * Enterprise and
     * Cloud editions keep the history; an open-source server keeps none and
     * answers UNIMPLEMENTED. A host may refuse the read for its own reasons,
     * such as a plan that does not include it.
     * </pre>
     */
    default void listAccessHistory(ai.stigmer.iam.grant.v1.ListAccessHistoryInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.AccessHistoryPage> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListAccessHistoryMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service GrantQueryController.
   * <pre>
   * GrantQueryController reads grants and answers what they allow.
   * Three of its RPCs read grant rows (get, listResourceAccessByPrincipal and
   * listAccessHistory); the others are checks and lookups over what the
   * grants and the authorization model together let a principal do. The checks
   * live beside the grants they are answered from, as OpenFGA's Check sits
   * beside its Write and Google Cloud's testIamPermissions beside its IAM
   * policies.
   * </pre>
   */
  public static abstract class GrantQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return GrantQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service GrantQueryController.
   * <pre>
   * GrantQueryController reads grants and answers what they allow.
   * Three of its RPCs read grant rows (get, listResourceAccessByPrincipal and
   * listAccessHistory); the others are checks and lookups over what the
   * grants and the authorization model together let a principal do. The checks
   * live beside the grants they are answered from, as OpenFGA's Check sits
   * beside its Write and Google Cloud's testIamPermissions beside its IAM
   * policies.
   * </pre>
   */
  public static final class GrantQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<GrantQueryControllerStub> {
    private GrantQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GrantQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GrantQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a grant by its unique identifier.
     * Returns the full grant including its principal, resource, and relation binding.
     * </pre>
     */
    public void get(ai.stigmer.iam.grant.v1.GrantId request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant> responseObserver) {
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
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    public void checkMyPermission(ai.stigmer.iam.grant.v1.CheckMyPermissionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.CheckAuthorizationResult> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCheckMyPermissionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing grants, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with grant spec and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    public void checkAuthorization(ai.stigmer.iam.grant.v1.CheckAuthorizationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.CheckAuthorizationResult> responseObserver) {
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
    public void listAuthorizedResourceIds(ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList> responseObserver) {
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
    public void listAuthorizedPrincipalIds(ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList> responseObserver) {
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
    public void listResourceAccessByPrincipal(ai.stigmer.iam.grant.v1.ListResourceAccessInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList> responseObserver) {
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
    public void getPrincipalResourceRoles(ai.stigmer.iam.grant.v1.PrincipalResourceInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.PrincipalResourceRoles> responseObserver) {
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
     * Input: GetPrincipalsCountInput with org and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    public void getPrincipalsCount(ai.stigmer.iam.grant.v1.GetPrincipalsCountInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.PrincipalsCount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetPrincipalsCountMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List an organization's access history: every time someone was given
     * or lost access to the organization or to a resource in it, who did it,
     * why, and when.
     * Without after_sequence the entries come newest first, for people
     * reading what happened lately. With after_sequence they come oldest
     * first, starting just after that entry, for a tool that keeps its own
     * copy: it asks for what came after the last entry it holds. Each
     * organization numbers its entries from 1 in the order they happened,
     * with no gaps above the oldest kept entry, so a reader that resumes
     * after entry N never misses one the server still keeps.
     * A server may keep the history for a limited time, set by its operator.
     * It then removes the oldest entries first and never reuses a number:
     * every page says how many days the server keeps the history
     * (retention_days, 0 for good) and the oldest number it still holds
     * (oldest_sequence), so a tool can tell entries that were removed from
     * entries it missed.
     * Only the organization's owners and administrators may read it, and a
     * parent organization's administrators for a child, since they are
     * administrators in every child. Whoever may read it reads all of it. The
     * Enterprise and
     * Cloud editions keep the history; an open-source server keeps none and
     * answers UNIMPLEMENTED. A host may refuse the read for its own reasons,
     * such as a plan that does not include it.
     * </pre>
     */
    public void listAccessHistory(ai.stigmer.iam.grant.v1.ListAccessHistoryInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.AccessHistoryPage> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListAccessHistoryMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service GrantQueryController.
   * <pre>
   * GrantQueryController reads grants and answers what they allow.
   * Three of its RPCs read grant rows (get, listResourceAccessByPrincipal and
   * listAccessHistory); the others are checks and lookups over what the
   * grants and the authorization model together let a principal do. The checks
   * live beside the grants they are answered from, as OpenFGA's Check sits
   * beside its Write and Google Cloud's testIamPermissions beside its IAM
   * policies.
   * </pre>
   */
  public static final class GrantQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<GrantQueryControllerBlockingV2Stub> {
    private GrantQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GrantQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GrantQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a grant by its unique identifier.
     * Returns the full grant including its principal, resource, and relation binding.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.Grant get(ai.stigmer.iam.grant.v1.GrantId request) throws io.grpc.StatusException {
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
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.CheckAuthorizationResult checkMyPermission(ai.stigmer.iam.grant.v1.CheckMyPermissionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCheckMyPermissionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing grants, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with grant spec and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.CheckAuthorizationResult checkAuthorization(ai.stigmer.iam.grant.v1.CheckAuthorizationInput request) throws io.grpc.StatusException {
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
    public ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList listAuthorizedResourceIds(ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput request) throws io.grpc.StatusException {
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
    public ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList listAuthorizedPrincipalIds(ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput request) throws io.grpc.StatusException {
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
    public ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList listResourceAccessByPrincipal(ai.stigmer.iam.grant.v1.ListResourceAccessInput request) throws io.grpc.StatusException {
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
    public ai.stigmer.iam.grant.v1.PrincipalResourceRoles getPrincipalResourceRoles(ai.stigmer.iam.grant.v1.PrincipalResourceInput request) throws io.grpc.StatusException {
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
     * Input: GetPrincipalsCountInput with org and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.PrincipalsCount getPrincipalsCount(ai.stigmer.iam.grant.v1.GetPrincipalsCountInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetPrincipalsCountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an organization's access history: every time someone was given
     * or lost access to the organization or to a resource in it, who did it,
     * why, and when.
     * Without after_sequence the entries come newest first, for people
     * reading what happened lately. With after_sequence they come oldest
     * first, starting just after that entry, for a tool that keeps its own
     * copy: it asks for what came after the last entry it holds. Each
     * organization numbers its entries from 1 in the order they happened,
     * with no gaps above the oldest kept entry, so a reader that resumes
     * after entry N never misses one the server still keeps.
     * A server may keep the history for a limited time, set by its operator.
     * It then removes the oldest entries first and never reuses a number:
     * every page says how many days the server keeps the history
     * (retention_days, 0 for good) and the oldest number it still holds
     * (oldest_sequence), so a tool can tell entries that were removed from
     * entries it missed.
     * Only the organization's owners and administrators may read it, and a
     * parent organization's administrators for a child, since they are
     * administrators in every child. Whoever may read it reads all of it. The
     * Enterprise and
     * Cloud editions keep the history; an open-source server keeps none and
     * answers UNIMPLEMENTED. A host may refuse the read for its own reasons,
     * such as a plan that does not include it.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.AccessHistoryPage listAccessHistory(ai.stigmer.iam.grant.v1.ListAccessHistoryInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListAccessHistoryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service GrantQueryController.
   * <pre>
   * GrantQueryController reads grants and answers what they allow.
   * Three of its RPCs read grant rows (get, listResourceAccessByPrincipal and
   * listAccessHistory); the others are checks and lookups over what the
   * grants and the authorization model together let a principal do. The checks
   * live beside the grants they are answered from, as OpenFGA's Check sits
   * beside its Write and Google Cloud's testIamPermissions beside its IAM
   * policies.
   * </pre>
   */
  public static final class GrantQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<GrantQueryControllerBlockingStub> {
    private GrantQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GrantQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GrantQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a grant by its unique identifier.
     * Returns the full grant including its principal, resource, and relation binding.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.Grant get(ai.stigmer.iam.grant.v1.GrantId request) {
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
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.CheckAuthorizationResult checkMyPermission(ai.stigmer.iam.grant.v1.CheckMyPermissionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCheckMyPermissionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing grants, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with grant spec and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.CheckAuthorizationResult checkAuthorization(ai.stigmer.iam.grant.v1.CheckAuthorizationInput request) {
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
    public ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList listAuthorizedResourceIds(ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput request) {
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
    public ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList listAuthorizedPrincipalIds(ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput request) {
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
    public ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList listResourceAccessByPrincipal(ai.stigmer.iam.grant.v1.ListResourceAccessInput request) {
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
    public ai.stigmer.iam.grant.v1.PrincipalResourceRoles getPrincipalResourceRoles(ai.stigmer.iam.grant.v1.PrincipalResourceInput request) {
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
     * Input: GetPrincipalsCountInput with org and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.PrincipalsCount getPrincipalsCount(ai.stigmer.iam.grant.v1.GetPrincipalsCountInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetPrincipalsCountMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List an organization's access history: every time someone was given
     * or lost access to the organization or to a resource in it, who did it,
     * why, and when.
     * Without after_sequence the entries come newest first, for people
     * reading what happened lately. With after_sequence they come oldest
     * first, starting just after that entry, for a tool that keeps its own
     * copy: it asks for what came after the last entry it holds. Each
     * organization numbers its entries from 1 in the order they happened,
     * with no gaps above the oldest kept entry, so a reader that resumes
     * after entry N never misses one the server still keeps.
     * A server may keep the history for a limited time, set by its operator.
     * It then removes the oldest entries first and never reuses a number:
     * every page says how many days the server keeps the history
     * (retention_days, 0 for good) and the oldest number it still holds
     * (oldest_sequence), so a tool can tell entries that were removed from
     * entries it missed.
     * Only the organization's owners and administrators may read it, and a
     * parent organization's administrators for a child, since they are
     * administrators in every child. Whoever may read it reads all of it. The
     * Enterprise and
     * Cloud editions keep the history; an open-source server keeps none and
     * answers UNIMPLEMENTED. A host may refuse the read for its own reasons,
     * such as a plan that does not include it.
     * </pre>
     */
    public ai.stigmer.iam.grant.v1.AccessHistoryPage listAccessHistory(ai.stigmer.iam.grant.v1.ListAccessHistoryInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListAccessHistoryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service GrantQueryController.
   * <pre>
   * GrantQueryController reads grants and answers what they allow.
   * Three of its RPCs read grant rows (get, listResourceAccessByPrincipal and
   * listAccessHistory); the others are checks and lookups over what the
   * grants and the authorization model together let a principal do. The checks
   * live beside the grants they are answered from, as OpenFGA's Check sits
   * beside its Write and Google Cloud's testIamPermissions beside its IAM
   * policies.
   * </pre>
   */
  public static final class GrantQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<GrantQueryControllerFutureStub> {
    private GrantQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected GrantQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new GrantQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a grant by its unique identifier.
     * Returns the full grant including its principal, resource, and relation binding.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.Grant> get(
        ai.stigmer.iam.grant.v1.GrantId request) {
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
     * Input: CheckMyPermissionInput with resource, relation, and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.CheckAuthorizationResult> checkMyPermission(
        ai.stigmer.iam.grant.v1.CheckMyPermissionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCheckMyPermissionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Check if a principal is authorized to perform a relation on a resource
     * This is the fundamental authorization check RPC that answers the question:
     * "Does principal X have permission Y on resource Z?"
     * It provides a simple boolean answer based on the complete authorization state,
     * including existing grants, inherited permissions, and group memberships.
     * This RPC is an INTERNAL-FACING contract for the platform's own
     * authorization pipeline (service-to-service and in-process checks).
     * Client-facing self checks must use checkMyPermission instead.
     * Use Cases:
     * - API request authorization before processing operations
     * - Service-to-service authorization
     * - Team-based access checks
     * Input: CheckAuthorizationInput with grant spec and optional contextual grants
     * Output: CheckAuthorizationResult with is_authorized boolean
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.CheckAuthorizationResult> checkAuthorization(
        ai.stigmer.iam.grant.v1.CheckAuthorizationInput request) {
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
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList> listAuthorizedResourceIds(
        ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput request) {
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
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList> listAuthorizedPrincipalIds(
        ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput request) {
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
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList> listResourceAccessByPrincipal(
        ai.stigmer.iam.grant.v1.ListResourceAccessInput request) {
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
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.PrincipalResourceRoles> getPrincipalResourceRoles(
        ai.stigmer.iam.grant.v1.PrincipalResourceInput request) {
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
     * Input: GetPrincipalsCountInput with org and principal_kind
     * Output: PrincipalsCount with integer count
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.PrincipalsCount> getPrincipalsCount(
        ai.stigmer.iam.grant.v1.GetPrincipalsCountInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetPrincipalsCountMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List an organization's access history: every time someone was given
     * or lost access to the organization or to a resource in it, who did it,
     * why, and when.
     * Without after_sequence the entries come newest first, for people
     * reading what happened lately. With after_sequence they come oldest
     * first, starting just after that entry, for a tool that keeps its own
     * copy: it asks for what came after the last entry it holds. Each
     * organization numbers its entries from 1 in the order they happened,
     * with no gaps above the oldest kept entry, so a reader that resumes
     * after entry N never misses one the server still keeps.
     * A server may keep the history for a limited time, set by its operator.
     * It then removes the oldest entries first and never reuses a number:
     * every page says how many days the server keeps the history
     * (retention_days, 0 for good) and the oldest number it still holds
     * (oldest_sequence), so a tool can tell entries that were removed from
     * entries it missed.
     * Only the organization's owners and administrators may read it, and a
     * parent organization's administrators for a child, since they are
     * administrators in every child. Whoever may read it reads all of it. The
     * Enterprise and
     * Cloud editions keep the history; an open-source server keeps none and
     * answers UNIMPLEMENTED. A host may refuse the read for its own reasons,
     * such as a plan that does not include it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.iam.grant.v1.AccessHistoryPage> listAccessHistory(
        ai.stigmer.iam.grant.v1.ListAccessHistoryInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListAccessHistoryMethod(), getCallOptions()), request);
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
  private static final int METHODID_LIST_ACCESS_HISTORY = 8;

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
          serviceImpl.get((ai.stigmer.iam.grant.v1.GrantId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.Grant>) responseObserver);
          break;
        case METHODID_CHECK_MY_PERMISSION:
          serviceImpl.checkMyPermission((ai.stigmer.iam.grant.v1.CheckMyPermissionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.CheckAuthorizationResult>) responseObserver);
          break;
        case METHODID_CHECK_AUTHORIZATION:
          serviceImpl.checkAuthorization((ai.stigmer.iam.grant.v1.CheckAuthorizationInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.CheckAuthorizationResult>) responseObserver);
          break;
        case METHODID_LIST_AUTHORIZED_RESOURCE_IDS:
          serviceImpl.listAuthorizedResourceIds((ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList>) responseObserver);
          break;
        case METHODID_LIST_AUTHORIZED_PRINCIPAL_IDS:
          serviceImpl.listAuthorizedPrincipalIds((ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList>) responseObserver);
          break;
        case METHODID_LIST_RESOURCE_ACCESS_BY_PRINCIPAL:
          serviceImpl.listResourceAccessByPrincipal((ai.stigmer.iam.grant.v1.ListResourceAccessInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList>) responseObserver);
          break;
        case METHODID_GET_PRINCIPAL_RESOURCE_ROLES:
          serviceImpl.getPrincipalResourceRoles((ai.stigmer.iam.grant.v1.PrincipalResourceInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.PrincipalResourceRoles>) responseObserver);
          break;
        case METHODID_GET_PRINCIPALS_COUNT:
          serviceImpl.getPrincipalsCount((ai.stigmer.iam.grant.v1.GetPrincipalsCountInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.PrincipalsCount>) responseObserver);
          break;
        case METHODID_LIST_ACCESS_HISTORY:
          serviceImpl.listAccessHistory((ai.stigmer.iam.grant.v1.ListAccessHistoryInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.iam.grant.v1.AccessHistoryPage>) responseObserver);
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
              ai.stigmer.iam.grant.v1.GrantId,
              ai.stigmer.iam.grant.v1.Grant>(
                service, METHODID_GET)))
        .addMethod(
          getCheckMyPermissionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.CheckMyPermissionInput,
              ai.stigmer.iam.grant.v1.CheckAuthorizationResult>(
                service, METHODID_CHECK_MY_PERMISSION)))
        .addMethod(
          getCheckAuthorizationMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.CheckAuthorizationInput,
              ai.stigmer.iam.grant.v1.CheckAuthorizationResult>(
                service, METHODID_CHECK_AUTHORIZATION)))
        .addMethod(
          getListAuthorizedResourceIdsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.ListAuthorizedResourceIdsInput,
              ai.stigmer.iam.grant.v1.AuthorizedResourceIdsList>(
                service, METHODID_LIST_AUTHORIZED_RESOURCE_IDS)))
        .addMethod(
          getListAuthorizedPrincipalIdsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.ListAuthorizedPrincipalIdsInput,
              ai.stigmer.iam.grant.v1.AuthorizedPrincipalIdsList>(
                service, METHODID_LIST_AUTHORIZED_PRINCIPAL_IDS)))
        .addMethod(
          getListResourceAccessByPrincipalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.ListResourceAccessInput,
              ai.stigmer.iam.grant.v1.ResourceAccessByPrincipalList>(
                service, METHODID_LIST_RESOURCE_ACCESS_BY_PRINCIPAL)))
        .addMethod(
          getGetPrincipalResourceRolesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.PrincipalResourceInput,
              ai.stigmer.iam.grant.v1.PrincipalResourceRoles>(
                service, METHODID_GET_PRINCIPAL_RESOURCE_ROLES)))
        .addMethod(
          getGetPrincipalsCountMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.GetPrincipalsCountInput,
              ai.stigmer.iam.grant.v1.PrincipalsCount>(
                service, METHODID_GET_PRINCIPALS_COUNT)))
        .addMethod(
          getListAccessHistoryMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.iam.grant.v1.ListAccessHistoryInput,
              ai.stigmer.iam.grant.v1.AccessHistoryPage>(
                service, METHODID_LIST_ACCESS_HISTORY)))
        .build();
  }

  private static abstract class GrantQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    GrantQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.iam.grant.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("GrantQueryController");
    }
  }

  private static final class GrantQueryControllerFileDescriptorSupplier
      extends GrantQueryControllerBaseDescriptorSupplier {
    GrantQueryControllerFileDescriptorSupplier() {}
  }

  private static final class GrantQueryControllerMethodDescriptorSupplier
      extends GrantQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    GrantQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (GrantQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new GrantQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getCheckMyPermissionMethod())
              .addMethod(getCheckAuthorizationMethod())
              .addMethod(getListAuthorizedResourceIdsMethod())
              .addMethod(getListAuthorizedPrincipalIdsMethod())
              .addMethod(getListResourceAccessByPrincipalMethod())
              .addMethod(getGetPrincipalResourceRolesMethod())
              .addMethod(getGetPrincipalsCountMethod())
              .addMethod(getListAccessHistoryMethod())
              .build();
        }
      }
    }
    return result;
  }
}
