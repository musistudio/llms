import { ProxyAgent } from "undici";
import { UnifiedChatRequest } from "../types/llm";
import { log } from "./log";

export function sendUnifiedRequest(
  url: URL | string,
  request: UnifiedChatRequest,
  config: any
): Promise<Response> {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (config.headers) {
    Object.entries(config.headers).forEach(([key, value]) => {
      headers.set(key, value as string);
    });
  }
  let combinedSignal: AbortSignal;
  const timeoutSignal = AbortSignal.timeout(config.TIMEOUT ?? 60 * 1000 * 60);

  if (config.signal) {
    const controller = new AbortController();
    const abortHandler = () => controller.abort();
    config.signal.addEventListener("abort", abortHandler);
    timeoutSignal.addEventListener("abort", abortHandler);
    combinedSignal = controller.signal;
  } else {
    combinedSignal = timeoutSignal;
  }

  // Apply extra headers if provided
  // This allows for dynamic headers to be set based on the request context
  if (request.extra_headers) {
    Object.entries(request.extra_headers).forEach(([key, value]) => {
      if (value) {
        headers.set(key, value as string);
      } else {
        headers.delete(key);
      }
    });
  }

  const fetchOptions: RequestInit = {
    method: "POST",
    headers: headers,
    body: JSON.stringify(request),
    signal: combinedSignal,
  };

  if (config.httpsProxy) {
    (fetchOptions as any).dispatcher = new ProxyAgent(
      new URL(config.httpsProxy).toString()
    );
  }
  log("final request:", typeof url === "string" ? url : url.toString(), config.httpsProxy, fetchOptions);
  return fetch(typeof url === "string" ? url : url.toString(), fetchOptions);
}
