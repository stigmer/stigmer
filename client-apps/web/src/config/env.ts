export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:7234";
}

export function getIamApiAudience(): string {
  return process.env.NEXT_PUBLIC_IAM_API_AUDIENCE ?? "https://api.stigmer.com/";
}
