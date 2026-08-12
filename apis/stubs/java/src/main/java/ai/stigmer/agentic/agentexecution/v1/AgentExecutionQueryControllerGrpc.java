package ai.stigmer.agentic.agentexecution.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * AgentExecutionQueryController handles read operations for agent executions.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class AgentExecutionQueryControllerGrpc {

  private AgentExecutionQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentexecution.v1.AgentExecutionQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecutionId,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.agentexecution.v1.AgentExecutionId.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecutionId,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecutionId, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getGetMethod;
    if ((getGetMethod = AgentExecutionQueryControllerGrpc.getGetMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getGetMethod = AgentExecutionQueryControllerGrpc.getGetMethod) == null) {
          AgentExecutionQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.AgentExecutionId, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecutionId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest,
      ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecutionList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest,
      ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest, ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> getListMethod;
    if ((getListMethod = AgentExecutionQueryControllerGrpc.getListMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getListMethod = AgentExecutionQueryControllerGrpc.getListMethod) == null) {
          AgentExecutionQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest, ai.stigmer.agentic.agentexecution.v1.AgentExecutionList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecutionList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest,
      ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> getListBySessionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listBySession",
      requestType = ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecutionList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest,
      ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> getListBySessionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest, ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> getListBySessionMethod;
    if ((getListBySessionMethod = AgentExecutionQueryControllerGrpc.getListBySessionMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getListBySessionMethod = AgentExecutionQueryControllerGrpc.getListBySessionMethod) == null) {
          AgentExecutionQueryControllerGrpc.getListBySessionMethod = getListBySessionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest, ai.stigmer.agentic.agentexecution.v1.AgentExecutionList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listBySession"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecutionList.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("listBySession"))
              .build();
        }
      }
    }
    return getListBySessionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecutionId,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getSubscribeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "subscribe",
      requestType = ai.stigmer.agentic.agentexecution.v1.AgentExecutionId.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecutionId,
      ai.stigmer.agentic.agentexecution.v1.AgentExecution> getSubscribeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.AgentExecutionId, ai.stigmer.agentic.agentexecution.v1.AgentExecution> getSubscribeMethod;
    if ((getSubscribeMethod = AgentExecutionQueryControllerGrpc.getSubscribeMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getSubscribeMethod = AgentExecutionQueryControllerGrpc.getSubscribeMethod) == null) {
          AgentExecutionQueryControllerGrpc.getSubscribeMethod = getSubscribeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.AgentExecutionId, ai.stigmer.agentic.agentexecution.v1.AgentExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.SERVER_STREAMING)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "subscribe"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecutionId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecution.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("subscribe"))
              .build();
        }
      }
    }
    return getSubscribeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest,
      ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse> getGetArtifactDownloadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getArtifactDownloadUrl",
      requestType = ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest,
      ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse> getGetArtifactDownloadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest, ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse> getGetArtifactDownloadUrlMethod;
    if ((getGetArtifactDownloadUrlMethod = AgentExecutionQueryControllerGrpc.getGetArtifactDownloadUrlMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getGetArtifactDownloadUrlMethod = AgentExecutionQueryControllerGrpc.getGetArtifactDownloadUrlMethod) == null) {
          AgentExecutionQueryControllerGrpc.getGetArtifactDownloadUrlMethod = getGetArtifactDownloadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest, ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getArtifactDownloadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("getArtifactDownloadUrl"))
              .build();
        }
      }
    }
    return getGetArtifactDownloadUrlMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest,
      ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse> getGetArtifactContentMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getArtifactContent",
      requestType = ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest,
      ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse> getGetArtifactContentMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest, ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse> getGetArtifactContentMethod;
    if ((getGetArtifactContentMethod = AgentExecutionQueryControllerGrpc.getGetArtifactContentMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getGetArtifactContentMethod = AgentExecutionQueryControllerGrpc.getGetArtifactContentMethod) == null) {
          AgentExecutionQueryControllerGrpc.getGetArtifactContentMethod = getGetArtifactContentMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest, ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getArtifactContent"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("getArtifactContent"))
              .build();
        }
      }
    }
    return getGetArtifactContentMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput,
      ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput> getGetExecutionUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getExecutionUsageReport",
      requestType = ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput,
      ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput> getGetExecutionUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput, ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput> getGetExecutionUsageReportMethod;
    if ((getGetExecutionUsageReportMethod = AgentExecutionQueryControllerGrpc.getGetExecutionUsageReportMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getGetExecutionUsageReportMethod = AgentExecutionQueryControllerGrpc.getGetExecutionUsageReportMethod) == null) {
          AgentExecutionQueryControllerGrpc.getGetExecutionUsageReportMethod = getGetExecutionUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput, ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getExecutionUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("getExecutionUsageReport"))
              .build();
        }
      }
    }
    return getGetExecutionUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput,
      ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput> getGetSessionUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getSessionUsageReport",
      requestType = ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput,
      ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput> getGetSessionUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput, ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput> getGetSessionUsageReportMethod;
    if ((getGetSessionUsageReportMethod = AgentExecutionQueryControllerGrpc.getGetSessionUsageReportMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getGetSessionUsageReportMethod = AgentExecutionQueryControllerGrpc.getGetSessionUsageReportMethod) == null) {
          AgentExecutionQueryControllerGrpc.getGetSessionUsageReportMethod = getGetSessionUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput, ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getSessionUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("getSessionUsageReport"))
              .build();
        }
      }
    }
    return getGetSessionUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput,
      ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput> getGetAgentUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getAgentUsageReport",
      requestType = ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput,
      ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput> getGetAgentUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput, ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput> getGetAgentUsageReportMethod;
    if ((getGetAgentUsageReportMethod = AgentExecutionQueryControllerGrpc.getGetAgentUsageReportMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getGetAgentUsageReportMethod = AgentExecutionQueryControllerGrpc.getGetAgentUsageReportMethod) == null) {
          AgentExecutionQueryControllerGrpc.getGetAgentUsageReportMethod = getGetAgentUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput, ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getAgentUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("getAgentUsageReport"))
              .build();
        }
      }
    }
    return getGetAgentUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput,
      ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput> getGetOrgUsageReportMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getOrgUsageReport",
      requestType = ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput,
      ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput> getGetOrgUsageReportMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput, ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput> getGetOrgUsageReportMethod;
    if ((getGetOrgUsageReportMethod = AgentExecutionQueryControllerGrpc.getGetOrgUsageReportMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getGetOrgUsageReportMethod = AgentExecutionQueryControllerGrpc.getGetOrgUsageReportMethod) == null) {
          AgentExecutionQueryControllerGrpc.getGetOrgUsageReportMethod = getGetOrgUsageReportMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput, ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getOrgUsageReport"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("getOrgUsageReport"))
              .build();
        }
      }
    }
    return getGetOrgUsageReportMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest,
      ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary> getGetExecutionSummaryMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getExecutionSummary",
      requestType = ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest.class,
      responseType = ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest,
      ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary> getGetExecutionSummaryMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest, ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary> getGetExecutionSummaryMethod;
    if ((getGetExecutionSummaryMethod = AgentExecutionQueryControllerGrpc.getGetExecutionSummaryMethod) == null) {
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        if ((getGetExecutionSummaryMethod = AgentExecutionQueryControllerGrpc.getGetExecutionSummaryMethod) == null) {
          AgentExecutionQueryControllerGrpc.getGetExecutionSummaryMethod = getGetExecutionSummaryMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest, ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getExecutionSummary"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary.getDefaultInstance()))
              .setSchemaDescriptor(new AgentExecutionQueryControllerMethodDescriptorSupplier("getExecutionSummary"))
              .build();
        }
      }
    }
    return getGetExecutionSummaryMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static AgentExecutionQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentExecutionQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentExecutionQueryControllerStub>() {
        @java.lang.Override
        public AgentExecutionQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentExecutionQueryControllerStub(channel, callOptions);
        }
      };
    return AgentExecutionQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static AgentExecutionQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentExecutionQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentExecutionQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public AgentExecutionQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentExecutionQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return AgentExecutionQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static AgentExecutionQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentExecutionQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentExecutionQueryControllerBlockingStub>() {
        @java.lang.Override
        public AgentExecutionQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentExecutionQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return AgentExecutionQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static AgentExecutionQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<AgentExecutionQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<AgentExecutionQueryControllerFutureStub>() {
        @java.lang.Override
        public AgentExecutionQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new AgentExecutionQueryControllerFutureStub(channel, callOptions);
        }
      };
    return AgentExecutionQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * AgentExecutionQueryController handles read operations for agent executions.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single agent execution by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.agentexecution.v1.AgentExecutionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all agent executions with pagination and optional filtering.
     * </pre>
     */
    default void list(ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_execution_ids,
     * then filtered by session_id. This ensures consistent authorization pattern across all list operations.
     * </pre>
     */
    default void listBySession(ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListBySessionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time execution updates (streaming).
     * &#64;internal
     * Authorization is handled by the FJ model via proto configuration.
     * </pre>
     */
    default void subscribe(ai.stigmer.agentic.agentexecution.v1.AgentExecutionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubscribeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * execution. The URL can be used with a simple HTTP GET request without
     * authentication.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only download files from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Two key forms are accepted:
     * - "artifacts/{execution_id}/..." — outputs published by the execution;
     *   the embedded execution id is the ownership proof
     * - a key listed verbatim in the execution's spec.attachments — inputs
     *   submitted with the turn ("attachments/{ulid}/{filename}", ULID-unique
     *   per upload); ownership is the spec reference, since the key carries
     *   no execution id
     * Any other key is rejected to prevent path traversal attacks.
     * ## URL Expiration
     * Download URLs expire after 7 days (configurable). After expiration,
     * call this endpoint again to get a fresh URL.
     * ## Use Cases
     * - CLI downloading agent-created files
     * - Web UI providing download links for artifacts
     * - Web UI rendering submitted attachments in the message thread
     * - Refreshing expired download URLs
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[] (or attachment in spec.attachments[])
     * 3. Call getArtifactDownloadUrl with execution_id and storage_key
     * 4. Use returned download_url for HTTP GET
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    default void getArtifactDownloadUrl(ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetArtifactDownloadUrlMethod(), responseObserver);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only read artifacts from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Keys must start with "artifacts/{execution_id}/" to prevent
     * path traversal attacks.
     * ## Size Limit
     * Content is truncated to max_bytes (default: 512 KB). The response
     * includes total_size_bytes and a truncated flag so callers can decide
     * whether to offer a full download via getArtifactDownloadUrl.
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[]
     * 3. Call getArtifactContent with execution_id and storage_key
     * 4. Decode content bytes as UTF-8 for text artifacts
     * 5. Parse YAML to detect Stigmer resource kind (Agent, McpServer, etc.)
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    default void getArtifactContent(ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetArtifactContentMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a single execution.
     * Returns aggregated tokens, cost, and per-model breakdown for one execution.
     * </pre>
     */
    default void getExecutionUsageReport(ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetExecutionUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    default void getSessionUsageReport(ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetSessionUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org_id; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * &#64;internal
     * Org-scoped by design (oss#389). Agent can_view is a consumption
     * permission — public agents grant it to every authenticated account via
     * the FGA wildcard — so gating on the agent would leak cross-tenant usage.
     * Gating on the organization also keeps other tenants' sessions of a
     * shared agent out of the report. Consumed by the CLI (`stigmer usage
     * agent`).
     * </pre>
     */
    default void getAgentUsageReport(ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetAgentUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    default void getOrgUsageReport(ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetOrgUsageReportMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent executions.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * &#64;internal
     * Authorization:
     * Custom authorization — user must have organization-level access.
     * Results are scoped to the user's organization.
     * Use Cases:
     * 1. Unified Dashboard Overview:
     *    - Display combined agent + workflow KPI cards
     *    - Agent phase counts are merged client-side with workflow phase counts
     * 2. Reliability Monitoring:
     *    - Surface top failing agents for investigation
     *    - Track failure rates across the organization
     * &#64;since Unified Platform Dashboard
     * </pre>
     */
    default void getExecutionSummary(ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetExecutionSummaryMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service AgentExecutionQueryController.
   * <pre>
   * AgentExecutionQueryController handles read operations for agent executions.
   * </pre>
   */
  public static abstract class AgentExecutionQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return AgentExecutionQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service AgentExecutionQueryController.
   * <pre>
   * AgentExecutionQueryController handles read operations for agent executions.
   * </pre>
   */
  public static final class AgentExecutionQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<AgentExecutionQueryControllerStub> {
    private AgentExecutionQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentExecutionQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentExecutionQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent execution by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.agentexecution.v1.AgentExecutionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all agent executions with pagination and optional filtering.
     * </pre>
     */
    public void list(ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_execution_ids,
     * then filtered by session_id. This ensures consistent authorization pattern across all list operations.
     * </pre>
     */
    public void listBySession(ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListBySessionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Subscribe to real-time execution updates (streaming).
     * &#64;internal
     * Authorization is handled by the FJ model via proto configuration.
     * </pre>
     */
    public void subscribe(ai.stigmer.agentic.agentexecution.v1.AgentExecutionId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncServerStreamingCall(
          getChannel().newCall(getSubscribeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * execution. The URL can be used with a simple HTTP GET request without
     * authentication.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only download files from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Two key forms are accepted:
     * - "artifacts/{execution_id}/..." — outputs published by the execution;
     *   the embedded execution id is the ownership proof
     * - a key listed verbatim in the execution's spec.attachments — inputs
     *   submitted with the turn ("attachments/{ulid}/{filename}", ULID-unique
     *   per upload); ownership is the spec reference, since the key carries
     *   no execution id
     * Any other key is rejected to prevent path traversal attacks.
     * ## URL Expiration
     * Download URLs expire after 7 days (configurable). After expiration,
     * call this endpoint again to get a fresh URL.
     * ## Use Cases
     * - CLI downloading agent-created files
     * - Web UI providing download links for artifacts
     * - Web UI rendering submitted attachments in the message thread
     * - Refreshing expired download URLs
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[] (or attachment in spec.attachments[])
     * 3. Call getArtifactDownloadUrl with execution_id and storage_key
     * 4. Use returned download_url for HTTP GET
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public void getArtifactDownloadUrl(ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetArtifactDownloadUrlMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only read artifacts from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Keys must start with "artifacts/{execution_id}/" to prevent
     * path traversal attacks.
     * ## Size Limit
     * Content is truncated to max_bytes (default: 512 KB). The response
     * includes total_size_bytes and a truncated flag so callers can decide
     * whether to offer a full download via getArtifactDownloadUrl.
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[]
     * 3. Call getArtifactContent with execution_id and storage_key
     * 4. Decode content bytes as UTF-8 for text artifacts
     * 5. Parse YAML to detect Stigmer resource kind (Agent, McpServer, etc.)
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public void getArtifactContent(ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetArtifactContentMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a single execution.
     * Returns aggregated tokens, cost, and per-model breakdown for one execution.
     * </pre>
     */
    public void getExecutionUsageReport(ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetExecutionUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    public void getSessionUsageReport(ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetSessionUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org_id; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * &#64;internal
     * Org-scoped by design (oss#389). Agent can_view is a consumption
     * permission — public agents grant it to every authenticated account via
     * the FGA wildcard — so gating on the agent would leak cross-tenant usage.
     * Gating on the organization also keeps other tenants' sessions of a
     * shared agent out of the report. Consumed by the CLI (`stigmer usage
     * agent`).
     * </pre>
     */
    public void getAgentUsageReport(ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetAgentUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public void getOrgUsageReport(ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetOrgUsageReportMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent executions.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * &#64;internal
     * Authorization:
     * Custom authorization — user must have organization-level access.
     * Results are scoped to the user's organization.
     * Use Cases:
     * 1. Unified Dashboard Overview:
     *    - Display combined agent + workflow KPI cards
     *    - Agent phase counts are merged client-side with workflow phase counts
     * 2. Reliability Monitoring:
     *    - Surface top failing agents for investigation
     *    - Track failure rates across the organization
     * &#64;since Unified Platform Dashboard
     * </pre>
     */
    public void getExecutionSummary(ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetExecutionSummaryMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service AgentExecutionQueryController.
   * <pre>
   * AgentExecutionQueryController handles read operations for agent executions.
   * </pre>
   */
  public static final class AgentExecutionQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<AgentExecutionQueryControllerBlockingV2Stub> {
    private AgentExecutionQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentExecutionQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentExecutionQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent execution by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution get(ai.stigmer.agentic.agentexecution.v1.AgentExecutionId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all agent executions with pagination and optional filtering.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecutionList list(ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_execution_ids,
     * then filtered by session_id. This ensures consistent authorization pattern across all list operations.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecutionList listBySession(ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListBySessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time execution updates (streaming).
     * &#64;internal
     * Authorization is handled by the FJ model via proto configuration.
     * </pre>
     */
    @io.grpc.ExperimentalApi("https://github.com/grpc/grpc-java/issues/10918")
    public io.grpc.stub.BlockingClientCall<?, ai.stigmer.agentic.agentexecution.v1.AgentExecution>
        subscribe(ai.stigmer.agentic.agentexecution.v1.AgentExecutionId request) {
      return io.grpc.stub.ClientCalls.blockingV2ServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * execution. The URL can be used with a simple HTTP GET request without
     * authentication.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only download files from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Two key forms are accepted:
     * - "artifacts/{execution_id}/..." — outputs published by the execution;
     *   the embedded execution id is the ownership proof
     * - a key listed verbatim in the execution's spec.attachments — inputs
     *   submitted with the turn ("attachments/{ulid}/{filename}", ULID-unique
     *   per upload); ownership is the spec reference, since the key carries
     *   no execution id
     * Any other key is rejected to prevent path traversal attacks.
     * ## URL Expiration
     * Download URLs expire after 7 days (configurable). After expiration,
     * call this endpoint again to get a fresh URL.
     * ## Use Cases
     * - CLI downloading agent-created files
     * - Web UI providing download links for artifacts
     * - Web UI rendering submitted attachments in the message thread
     * - Refreshing expired download URLs
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[] (or attachment in spec.attachments[])
     * 3. Call getArtifactDownloadUrl with execution_id and storage_key
     * 4. Use returned download_url for HTTP GET
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse getArtifactDownloadUrl(ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetArtifactDownloadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only read artifacts from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Keys must start with "artifacts/{execution_id}/" to prevent
     * path traversal attacks.
     * ## Size Limit
     * Content is truncated to max_bytes (default: 512 KB). The response
     * includes total_size_bytes and a truncated flag so callers can decide
     * whether to offer a full download via getArtifactDownloadUrl.
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[]
     * 3. Call getArtifactContent with execution_id and storage_key
     * 4. Decode content bytes as UTF-8 for text artifacts
     * 5. Parse YAML to detect Stigmer resource kind (Agent, McpServer, etc.)
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse getArtifactContent(ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetArtifactContentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a single execution.
     * Returns aggregated tokens, cost, and per-model breakdown for one execution.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput getExecutionUsageReport(ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetExecutionUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput getSessionUsageReport(ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetSessionUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org_id; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * &#64;internal
     * Org-scoped by design (oss#389). Agent can_view is a consumption
     * permission — public agents grant it to every authenticated account via
     * the FGA wildcard — so gating on the agent would leak cross-tenant usage.
     * Gating on the organization also keeps other tenants' sessions of a
     * shared agent out of the report. Consumed by the CLI (`stigmer usage
     * agent`).
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput getAgentUsageReport(ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetAgentUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput getOrgUsageReport(ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetOrgUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent executions.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * &#64;internal
     * Authorization:
     * Custom authorization — user must have organization-level access.
     * Results are scoped to the user's organization.
     * Use Cases:
     * 1. Unified Dashboard Overview:
     *    - Display combined agent + workflow KPI cards
     *    - Agent phase counts are merged client-side with workflow phase counts
     * 2. Reliability Monitoring:
     *    - Surface top failing agents for investigation
     *    - Track failure rates across the organization
     * &#64;since Unified Platform Dashboard
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary getExecutionSummary(ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetExecutionSummaryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service AgentExecutionQueryController.
   * <pre>
   * AgentExecutionQueryController handles read operations for agent executions.
   * </pre>
   */
  public static final class AgentExecutionQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<AgentExecutionQueryControllerBlockingStub> {
    private AgentExecutionQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentExecutionQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentExecutionQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent execution by ID.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecution get(ai.stigmer.agentic.agentexecution.v1.AgentExecutionId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all agent executions with pagination and optional filtering.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecutionList list(ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_execution_ids,
     * then filtered by session_id. This ensures consistent authorization pattern across all list operations.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecutionList listBySession(ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListBySessionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Subscribe to real-time execution updates (streaming).
     * &#64;internal
     * Authorization is handled by the FJ model via proto configuration.
     * </pre>
     */
    public java.util.Iterator<ai.stigmer.agentic.agentexecution.v1.AgentExecution> subscribe(
        ai.stigmer.agentic.agentexecution.v1.AgentExecutionId request) {
      return io.grpc.stub.ClientCalls.blockingServerStreamingCall(
          getChannel(), getSubscribeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * execution. The URL can be used with a simple HTTP GET request without
     * authentication.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only download files from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Two key forms are accepted:
     * - "artifacts/{execution_id}/..." — outputs published by the execution;
     *   the embedded execution id is the ownership proof
     * - a key listed verbatim in the execution's spec.attachments — inputs
     *   submitted with the turn ("attachments/{ulid}/{filename}", ULID-unique
     *   per upload); ownership is the spec reference, since the key carries
     *   no execution id
     * Any other key is rejected to prevent path traversal attacks.
     * ## URL Expiration
     * Download URLs expire after 7 days (configurable). After expiration,
     * call this endpoint again to get a fresh URL.
     * ## Use Cases
     * - CLI downloading agent-created files
     * - Web UI providing download links for artifacts
     * - Web UI rendering submitted attachments in the message thread
     * - Refreshing expired download URLs
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[] (or attachment in spec.attachments[])
     * 3. Call getArtifactDownloadUrl with execution_id and storage_key
     * 4. Use returned download_url for HTTP GET
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse getArtifactDownloadUrl(ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetArtifactDownloadUrlMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only read artifacts from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Keys must start with "artifacts/{execution_id}/" to prevent
     * path traversal attacks.
     * ## Size Limit
     * Content is truncated to max_bytes (default: 512 KB). The response
     * includes total_size_bytes and a truncated flag so callers can decide
     * whether to offer a full download via getArtifactDownloadUrl.
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[]
     * 3. Call getArtifactContent with execution_id and storage_key
     * 4. Decode content bytes as UTF-8 for text artifacts
     * 5. Parse YAML to detect Stigmer resource kind (Agent, McpServer, etc.)
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse getArtifactContent(ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetArtifactContentMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a single execution.
     * Returns aggregated tokens, cost, and per-model breakdown for one execution.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput getExecutionUsageReport(ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetExecutionUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput getSessionUsageReport(ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetSessionUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org_id; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * &#64;internal
     * Org-scoped by design (oss#389). Agent can_view is a consumption
     * permission — public agents grant it to every authenticated account via
     * the FGA wildcard — so gating on the agent would leak cross-tenant usage.
     * Gating on the organization also keeps other tenants' sessions of a
     * shared agent out of the report. Consumed by the CLI (`stigmer usage
     * agent`).
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput getAgentUsageReport(ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetAgentUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput getOrgUsageReport(ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetOrgUsageReportMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent executions.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * &#64;internal
     * Authorization:
     * Custom authorization — user must have organization-level access.
     * Results are scoped to the user's organization.
     * Use Cases:
     * 1. Unified Dashboard Overview:
     *    - Display combined agent + workflow KPI cards
     *    - Agent phase counts are merged client-side with workflow phase counts
     * 2. Reliability Monitoring:
     *    - Surface top failing agents for investigation
     *    - Track failure rates across the organization
     * &#64;since Unified Platform Dashboard
     * </pre>
     */
    public ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary getExecutionSummary(ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetExecutionSummaryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service AgentExecutionQueryController.
   * <pre>
   * AgentExecutionQueryController handles read operations for agent executions.
   * </pre>
   */
  public static final class AgentExecutionQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<AgentExecutionQueryControllerFutureStub> {
    private AgentExecutionQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected AgentExecutionQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new AgentExecutionQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single agent execution by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecution> get(
        ai.stigmer.agentic.agentexecution.v1.AgentExecutionId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all agent executions with pagination and optional filtering.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> list(
        ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List all executions in a specific session.
     * &#64;internal
     * Authorization is handled in handler via FGA query for authorized agent_execution_ids,
     * then filtered by session_id. This ensures consistent authorization pattern across all list operations.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecutionList> listBySession(
        ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListBySessionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a presigned download URL for an execution artifact or attachment.
     * Returns a time-limited URL for downloading an artifact published by
     * an agent during execution, or an attachment submitted with the
     * execution. The URL can be used with a simple HTTP GET request without
     * authentication.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only download files from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Two key forms are accepted:
     * - "artifacts/{execution_id}/..." — outputs published by the execution;
     *   the embedded execution id is the ownership proof
     * - a key listed verbatim in the execution's spec.attachments — inputs
     *   submitted with the turn ("attachments/{ulid}/{filename}", ULID-unique
     *   per upload); ownership is the spec reference, since the key carries
     *   no execution id
     * Any other key is rejected to prevent path traversal attacks.
     * ## URL Expiration
     * Download URLs expire after 7 days (configurable). After expiration,
     * call this endpoint again to get a fresh URL.
     * ## Use Cases
     * - CLI downloading agent-created files
     * - Web UI providing download links for artifacts
     * - Web UI rendering submitted attachments in the message thread
     * - Refreshing expired download URLs
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[] (or attachment in spec.attachments[])
     * 3. Call getArtifactDownloadUrl with execution_id and storage_key
     * 4. Use returned download_url for HTTP GET
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse> getArtifactDownloadUrl(
        ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetArtifactDownloadUrlMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Read the raw content of an execution artifact.
     * Returns artifact bytes through the Stigmer API, eliminating CORS
     * concerns for SDK consumers who need to read content programmatically
     * (e.g., YAML parsing for resource detection, in-app preview rendering).
     * For direct file downloads, use getArtifactDownloadUrl instead — it
     * returns a presigned R2 URL that avoids proxying bytes through the server.
     * &#64;internal
     * ## Authorization
     * Requires can_view permission on the execution. This ensures users can
     * only read artifacts from executions they have access to.
     * ## Security
     * The storage_key is validated to ensure it belongs to the specified
     * execution. Keys must start with "artifacts/{execution_id}/" to prevent
     * path traversal attacks.
     * ## Size Limit
     * Content is truncated to max_bytes (default: 512 KB). The response
     * includes total_size_bytes and a truncated flag so callers can decide
     * whether to offer a full download via getArtifactDownloadUrl.
     * ## Example Flow
     * 1. Get execution via AgentExecutionQueryController.get
     * 2. Find artifact in status.artifacts[]
     * 3. Call getArtifactContent with execution_id and storage_key
     * 4. Decode content bytes as UTF-8 for text artifacts
     * 5. Parse YAML to detect Stigmer resource kind (Agent, McpServer, etc.)
     * &#64;since Artifact Lifecycle (Attachments &amp; Artifacts)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse> getArtifactContent(
        ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetArtifactContentMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for a single execution.
     * Returns aggregated tokens, cost, and per-model breakdown for one execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput> getExecutionUsageReport(
        ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetExecutionUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for a session.
     * Returns aggregated tokens, cost, and per-execution breakdown.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput> getSessionUsageReport(
        ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetSessionUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for an agent within an organization.
     * Returns aggregated tokens, cost, and per-session breakdown for one
     * organization's executions of the agent. Requires can_view on the
     * organization named in org_id; executions outside that organization are
     * never included, so the report is the per-agent drill-down of
     * getOrgUsageReport.
     * &#64;internal
     * Org-scoped by design (oss#389). Agent can_view is a consumption
     * permission — public agents grant it to every authenticated account via
     * the FGA wildcard — so gating on the agent would leak cross-tenant usage.
     * Gating on the organization also keeps other tenants' sessions of a
     * shared agent out of the report. Consumed by the CLI (`stigmer usage
     * agent`).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput> getAgentUsageReport(
        ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetAgentUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a usage report for an organization.
     * Returns org-wide totals, top agents by cost, model breakdown, and daily trend.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput> getOrgUsageReport(
        ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetOrgUsageReportMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get aggregated execution statistics for an organization's agent executions.
     * Returns counts by phase, active count, average duration, and top failing
     * agents — scoped to a configurable time window (24h, 7d, 30d, all-time).
     * &#64;internal
     * Authorization:
     * Custom authorization — user must have organization-level access.
     * Results are scoped to the user's organization.
     * Use Cases:
     * 1. Unified Dashboard Overview:
     *    - Display combined agent + workflow KPI cards
     *    - Agent phase counts are merged client-side with workflow phase counts
     * 2. Reliability Monitoring:
     *    - Surface top failing agents for investigation
     *    - Track failure rates across the organization
     * &#64;since Unified Platform Dashboard
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary> getExecutionSummary(
        ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetExecutionSummaryMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST = 1;
  private static final int METHODID_LIST_BY_SESSION = 2;
  private static final int METHODID_SUBSCRIBE = 3;
  private static final int METHODID_GET_ARTIFACT_DOWNLOAD_URL = 4;
  private static final int METHODID_GET_ARTIFACT_CONTENT = 5;
  private static final int METHODID_GET_EXECUTION_USAGE_REPORT = 6;
  private static final int METHODID_GET_SESSION_USAGE_REPORT = 7;
  private static final int METHODID_GET_AGENT_USAGE_REPORT = 8;
  private static final int METHODID_GET_ORG_USAGE_REPORT = 9;
  private static final int METHODID_GET_EXECUTION_SUMMARY = 10;

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
          serviceImpl.get((ai.stigmer.agentic.agentexecution.v1.AgentExecutionId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecutionList>) responseObserver);
          break;
        case METHODID_LIST_BY_SESSION:
          serviceImpl.listBySession((ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecutionList>) responseObserver);
          break;
        case METHODID_SUBSCRIBE:
          serviceImpl.subscribe((ai.stigmer.agentic.agentexecution.v1.AgentExecutionId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecution>) responseObserver);
          break;
        case METHODID_GET_ARTIFACT_DOWNLOAD_URL:
          serviceImpl.getArtifactDownloadUrl((ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse>) responseObserver);
          break;
        case METHODID_GET_ARTIFACT_CONTENT:
          serviceImpl.getArtifactContent((ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse>) responseObserver);
          break;
        case METHODID_GET_EXECUTION_USAGE_REPORT:
          serviceImpl.getExecutionUsageReport((ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_SESSION_USAGE_REPORT:
          serviceImpl.getSessionUsageReport((ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_AGENT_USAGE_REPORT:
          serviceImpl.getAgentUsageReport((ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_ORG_USAGE_REPORT:
          serviceImpl.getOrgUsageReport((ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput>) responseObserver);
          break;
        case METHODID_GET_EXECUTION_SUMMARY:
          serviceImpl.getExecutionSummary((ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary>) responseObserver);
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
              ai.stigmer.agentic.agentexecution.v1.AgentExecutionId,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsRequest,
              ai.stigmer.agentic.agentexecution.v1.AgentExecutionList>(
                service, METHODID_LIST)))
        .addMethod(
          getListBySessionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.ListAgentExecutionsBySessionRequest,
              ai.stigmer.agentic.agentexecution.v1.AgentExecutionList>(
                service, METHODID_LIST_BY_SESSION)))
        .addMethod(
          getSubscribeMethod(),
          io.grpc.stub.ServerCalls.asyncServerStreamingCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.AgentExecutionId,
              ai.stigmer.agentic.agentexecution.v1.AgentExecution>(
                service, METHODID_SUBSCRIBE)))
        .addMethod(
          getGetArtifactDownloadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlRequest,
              ai.stigmer.agentic.agentexecution.v1.GetArtifactDownloadUrlResponse>(
                service, METHODID_GET_ARTIFACT_DOWNLOAD_URL)))
        .addMethod(
          getGetArtifactContentMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.GetArtifactContentRequest,
              ai.stigmer.agentic.agentexecution.v1.GetArtifactContentResponse>(
                service, METHODID_GET_ARTIFACT_CONTENT)))
        .addMethod(
          getGetExecutionUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportInput,
              ai.stigmer.agentic.agentexecution.v1.GetExecutionUsageReportOutput>(
                service, METHODID_GET_EXECUTION_USAGE_REPORT)))
        .addMethod(
          getGetSessionUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportInput,
              ai.stigmer.agentic.agentexecution.v1.GetSessionUsageReportOutput>(
                service, METHODID_GET_SESSION_USAGE_REPORT)))
        .addMethod(
          getGetAgentUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportInput,
              ai.stigmer.agentic.agentexecution.v1.GetAgentUsageReportOutput>(
                service, METHODID_GET_AGENT_USAGE_REPORT)))
        .addMethod(
          getGetOrgUsageReportMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportInput,
              ai.stigmer.agentic.agentexecution.v1.GetOrgUsageReportOutput>(
                service, METHODID_GET_ORG_USAGE_REPORT)))
        .addMethod(
          getGetExecutionSummaryMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentexecution.v1.GetAgentExecutionSummaryRequest,
              ai.stigmer.agentic.agentexecution.v1.AgentExecutionSummary>(
                service, METHODID_GET_EXECUTION_SUMMARY)))
        .build();
  }

  private static abstract class AgentExecutionQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    AgentExecutionQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentexecution.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("AgentExecutionQueryController");
    }
  }

  private static final class AgentExecutionQueryControllerFileDescriptorSupplier
      extends AgentExecutionQueryControllerBaseDescriptorSupplier {
    AgentExecutionQueryControllerFileDescriptorSupplier() {}
  }

  private static final class AgentExecutionQueryControllerMethodDescriptorSupplier
      extends AgentExecutionQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    AgentExecutionQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (AgentExecutionQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new AgentExecutionQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .addMethod(getListBySessionMethod())
              .addMethod(getSubscribeMethod())
              .addMethod(getGetArtifactDownloadUrlMethod())
              .addMethod(getGetArtifactContentMethod())
              .addMethod(getGetExecutionUsageReportMethod())
              .addMethod(getGetSessionUsageReportMethod())
              .addMethod(getGetAgentUsageReportMethod())
              .addMethod(getGetOrgUsageReportMethod())
              .addMethod(getGetExecutionSummaryMethod())
              .build();
        }
      }
    }
    return result;
  }
}
