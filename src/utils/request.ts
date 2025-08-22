import { ProxyAgent } from "undici";
import { UnifiedChatRequest } from "../types/llm";

export function sendUnifiedRequest(
  url: URL | string,
  request: UnifiedChatRequest,
  config: any,
  logger?: any
): Promise<Response> {
  const headers = new Headers({
    "Content-Type": "application/json",
  });
  if (config.headers) {
    Object.entries(config.headers).forEach(([key, value]) => {
      if (value) {
        headers.set(key, value as string);
      }
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
  logger?.debug(
    {
      request: fetchOptions,
      headers: Object.fromEntries(headers.entries()),
      requestUrl: typeof url === "string" ? url : url.toString(),
      useProxy: config.httpsProxy,
    },
    "final request"
  );

  // CRITICAL DEBUG: Log actual HTTP body being sent
  const actualHttpBody = JSON.stringify(request);
  console.log("[HTTP EGRESS DEBUG] ACTUAL REQUEST BODY BEING SENT:", actualHttpBody);
  console.log("[HTTP EGRESS DEBUG] REQUEST OBJECT KEYS:", Object.keys(request));
  console.log("[HTTP EGRESS DEBUG] HAS REASONING PARAM:", 'reasoning' in request);
  console.log("[HTTP EGRESS DEBUG] HAS REASONING_EFFORT PARAM:", 'reasoning_effort' in request);
  
  // GPT-5 Reasoning Parameter Assertion
  if ('reasoning' in request && request.model && !/^(o3|o4|gpt-5)/.test(request.model)) {
    console.error("[REASONING ASSERTION FAILED] Reasoning parameter found on non-reasoning model!");
    console.error("[REASONING ASSERTION] Model:", request.model);
    console.error("[REASONING ASSERTION] Reasoning param:", request.reasoning);
    console.trace("[REASONING ASSERTION] Stack trace:");
    // Don't throw, just log the violation for now
  }

  return fetch(typeof url === "string" ? url : url.toString(), fetchOptions);
}
