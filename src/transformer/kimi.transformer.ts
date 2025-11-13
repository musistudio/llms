import { Transformer, TransformerContext } from "@/types/transformer";
import { UnifiedChatRequest, UnifiedMessage, LLMProvider } from "@/types/llm";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
}

export interface KimiTransformerOptions {
  // OpenAI compatibility
  toolChoiceDefault?: "auto" | "none" | "required";
  acceptRoleTool?: boolean;
  enforceFinishReasonLoop?: boolean;

  // Streaming tool_calls delta assembly is implemented for SSE responses
  assembleToolDeltas?: boolean;

  // Tool parser
  manualToolParsing?: boolean;
  emitToolCallsInJson?: boolean;
  toolTokens?: {
    sectionBegin: string;
    sectionEnd: string;
    callBegin: string;
    callEnd: string;
    argBegin: string;
  };

  // ID normalization
  idNormalization?: boolean;
  idPrefix?: string;
  counterScope?: "conversation";
  repairOnMismatch?: boolean;
}

export class KimiTransformer implements Transformer {
  name = "Kimi";
  endPoint = "/v1/chat/completions";

  private options: KimiTransformerOptions;

  // Cached regex patterns
  private regexCache: {
    section?: RegExp;
    call?: RegExp;
    arg?: RegExp;
    id?: RegExp;
  } = {};


  constructor(options: KimiTransformerOptions = {}) {
    this.options = options;
    const defaults: KimiTransformerOptions = {
      toolChoiceDefault: "auto",
      acceptRoleTool: true,
      enforceFinishReasonLoop: true,
      manualToolParsing: false,
      emitToolCallsInJson: false,
      toolTokens: {
        sectionBegin: "<|tool_calls_section_begin|>",
        sectionEnd: "<|tool_calls_section_end|>",
        callBegin: "<|tool_call_begin|>",
        callEnd: "<|tool_call_end|>",
        argBegin: "<|tool_call_argument_begin|>",
      },
      idNormalization: false,
      idPrefix: "functions",
      counterScope: "conversation",
      repairOnMismatch: true,
      assembleToolDeltas: false,
    };

    this.options = this.deepMerge(defaults, options);
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        const sourceValue = source[key];
        const targetValue = result[key];
        if (this.isObject(sourceValue) && this.isObject(targetValue)) {
          result[key] = this.deepMerge(targetValue, sourceValue);
        } else if (sourceValue !== undefined) {
          result[key] = sourceValue;
        }
      }
    }
    return result;
  }

  private isObject(value: any): value is Record<string, any> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  async transformRequestIn(
    request: UnifiedChatRequest,
    _provider: LLMProvider,
    _context: TransformerContext,
  ): Promise<Record<string, any>> {
    if (request.tools && request.tools.length > 0 && !request.tool_choice) {
      request.tool_choice = this.options.toolChoiceDefault;
    }

    if (this.options.acceptRoleTool) {
      for (const message of request.messages) {
        if (message.role === "tool") {
          if (!message.tool_call_id || !message.content) {
            throw new Error("Tool messages must have tool_call_id and content");
          }
        }
      }
    }


    return request;
  }

  /**
   * Transform outgoing requests (from unified format to Kimi-specific format)
   */
  async transformRequestOut(request: any, _context: TransformerContext): Promise<UnifiedChatRequest> {
    // Kimi-K2 is OpenAI-compatible; preserve unified shape.
    const body = { ...request };

    if (Array.isArray(body.tools) && body.tools.length > 0 && !body.tool_choice) {
      body.tool_choice = this.options.toolChoiceDefault;
    }

    // Stay neutral: do not drop metadata or extra fields.
    return body;
  }

  /**
   * Transform provider responses (Kimi format -> unified format).
   * This is the primary response hook for Kimi, keeping behavior Kimi-specific.
   */
  async transformResponseOut(response: Response, context: TransformerContext): Promise<Response> {
    const request = context?.req?.body as UnifiedChatRequest | undefined;

    // Streaming: wrap SSE and (optionally) assemble tool_calls deltas.
    if (this.isStreamingResponse(response)) {
      return this.handleStreamingToolCalls(response, request);
    }

    // Manual K2 marker parsing for non-streaming responses.
    if (this.options.manualToolParsing && request) {
      return this.handleManualToolParsing(response, request);
    }

    // Optional ID normalization/repair for native tool_calls.
    if ((this.options.idNormalization || this.options.repairOnMismatch) && request) {
      try {
        const clone = response.clone();
        const json = (await clone.json()) as OpenAIResponse;
        const choice = json.choices?.[0];
        const msg = choice?.message;
        if (msg?.tool_calls && Array.isArray(msg.tool_calls)) {
          msg.tool_calls = this.repairOrNormalizeToolCalls(
            msg.tool_calls,
            request.messages || [],
          );
          if (this.options.enforceFinishReasonLoop && msg.tool_calls.length > 0) {
            choice!.finish_reason = "tool_calls";
          }
          return new Response(JSON.stringify(json), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }
      } catch {
        // Fall through on parse errors.
      }
    }

    // Default: pass through Kimi's OpenAI-compatible response unchanged.
    return response;
  }

  private extractToolCallInfo(text: string): {
    toolCalls: ToolCall[];
    cleanContent: string;
  } {
    if (!text || typeof text !== "string") {
      return { toolCalls: [], cleanContent: text };
    }

    if (!this.options.toolTokens) {
      return { toolCalls: [], cleanContent: text };
    }

    const regex = this.getRegexPatterns();
    const sectionRegex = regex.section!;

    const toolCalls: ToolCall[] = [];
    let cleanContent = text;

    try {
      const sectionMatch = text.match(sectionRegex);
      if (sectionMatch) {
        const sectionContent = sectionMatch[1];
        const parsedToolCalls = this.parseToolCallsFromSection(sectionContent);
        toolCalls.push(...parsedToolCalls);
        cleanContent = text.replace(sectionRegex, "").trim();
      }
    } catch {
      console.error("Error parsing tool calls from text");
      return { toolCalls: [], cleanContent: text };
    }

    return { toolCalls, cleanContent };
  }

  private parseToolCallsFromSection(sectionContent: string): ToolCall[] {
    const toolCalls: ToolCall[] = [];
    const regex = this.getRegexPatterns();
    const callRegex = regex.call!;
    const argRegex = regex.arg!;

    let callMatch;
    while ((callMatch = callRegex.exec(sectionContent)) !== null) {
      const callContent = callMatch[1];
      const argMatch = callContent.match(argRegex);
      if (argMatch) {
        const toolCall = this.extractFunctionInfo(callContent, argMatch[1]);
        if (toolCall) {
          toolCalls.push(toolCall);
        }
      }
    }

    return toolCalls;
  }

  private extractFunctionInfo(callContent: string, args: string): ToolCall | null {
    try {
      const argMarkerIndex = callContent.indexOf(this.options.toolTokens!.argBegin);
      if (argMarkerIndex <= 0) return null;

      const functionId = callContent.substring(0, argMarkerIndex).trim();
      const trimmedArgs = args.trim();

      const idParts = functionId.split(".");
      let functionName = functionId;
      if (idParts.length >= 2) {
        const namePart = idParts[1].split(":")[0];
        functionName = namePart || functionId;
      }

      return {
        id: functionId,
        type: "function",
        function: {
          name: functionName,
          arguments: trimmedArgs,
        },
      };
    } catch {
      console.warn("Error extracting function info");
      return null;
    }
  }

  private getRegexPatterns() {
    const tokens = this.options.toolTokens!;
    if (
      !this.regexCache.section ||
      this.regexCache.section.source !==
        `${this.escapeRegex(tokens.sectionBegin)}(.*?)${this.escapeRegex(tokens.sectionEnd)}`
    ) {
      this.regexCache = {
        section: new RegExp(
          `${this.escapeRegex(tokens.sectionBegin)}(.*?)${this.escapeRegex(tokens.sectionEnd)}`,
          "s",
        ),
        call: new RegExp(
          `${this.escapeRegex(tokens.callBegin)}(.*?)${this.escapeRegex(tokens.callEnd)}`,
          "gs",
        ),
        arg: new RegExp(`${this.escapeRegex(tokens.argBegin)}(.*)`, "s"),
        id: new RegExp(
          `${this.escapeRegex(this.options.idPrefix!)}\.[^:]+:(\\d+)`,
          "g",
        ),
      };
    }
    return this.regexCache;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private getNextToolCallIndex(messages: UnifiedMessage[]): number {
    if (!messages || !Array.isArray(messages)) {
      return 0;
    }
    if (!this.options.idPrefix) {
      return 0;
    }
    const idRegex = this.getRegexPatterns().id!;
    let maxIndex = -1;

    for (const message of messages) {
      if ((message as any).tool_calls) {
        for (const toolCall of (message as any).tool_calls as ToolCall[]) {
          const matches = [...toolCall.id.matchAll(idRegex)];
          for (const match of matches) {
            const index = parseInt(match[1], 10);
            if (!Number.isNaN(index)) {
              maxIndex = Math.max(maxIndex, index);
            }
          }
        }
      }
      if (message.role === "tool" && (message as any).tool_call_id) {
        const matches = [...((message as any).tool_call_id as string).matchAll(idRegex)];
        for (const match of matches) {
          const index = parseInt(match[1], 10);
          if (!Number.isNaN(index)) {
            maxIndex = Math.max(maxIndex, index);
          }
        }
      }
    }

    return maxIndex + 1;
  }

  private repairOrNormalizeToolCalls(
    toolCalls: ToolCall[],
    messages: UnifiedMessage[],
  ): ToolCall[] {
    if (!this.options.idNormalization && !this.options.repairOnMismatch) {
      return toolCalls;
    }
    if (!toolCalls || !toolCalls.length) return toolCalls;
    if (!this.options.idPrefix) {
      return toolCalls;
    }

    const idRegex = this.getRegexPatterns().id!;
    const prefix = this.options.idPrefix;
    const nextIndexBase = this.getNextToolCallIndex(messages);
    let offset = 0;

    return toolCalls.map((call) => {
      const isValid = idRegex.test(call.id);
      idRegex.lastIndex = 0;
      if (this.options.idNormalization || (this.options.repairOnMismatch && !isValid)) {
        const functionName = call.function.name;
        const normalizedId = `${prefix}.${functionName}:${nextIndexBase + offset}`;
        offset += 1;
        return { ...call, id: normalizedId };
      }
      return call;
    });
  }

  private async handleManualToolParsing(
    response: Response,
    request: UnifiedChatRequest,
  ): Promise<Response> {
    if (!request?.messages) {
      return response;
    }

    let jsonResponse: OpenAIResponse;
    try {
      jsonResponse = (await response.json()) as OpenAIResponse;
    } catch {
      return response;
    }

    try {
      const choice = jsonResponse.choices?.[0];
      const message = choice?.message;
      if (message?.content) {
        const { toolCalls, cleanContent } = this.extractToolCallInfo(message.content);
        if (toolCalls.length > 0) {
          const normalizedToolCalls = this.repairOrNormalizeToolCalls(
            toolCalls,
            request.messages || [],
          );
          message.tool_calls = normalizedToolCalls;
          message.content = this.options.emitToolCallsInJson ? cleanContent : cleanContent;
          if (this.options.enforceFinishReasonLoop) {
            choice!.finish_reason = "tool_calls";
          }
        }
      }
    } catch {
      // On error, fall through with original jsonResponse
    }

    return new Response(JSON.stringify(jsonResponse), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  private handleStreamingToolCalls(
    response: Response,
    request?: UnifiedChatRequest,
  ): Response {
    if (!response.body) return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const assemble = this.options.assembleToolDeltas === true;
    const idPrefix = this.options.idPrefix || "functions";

    // Per-stream state (do NOT use shared instance state)
    const toolCallBuffers = new Map<number, ToolCall>();
    let finalized = false;

    const stream = new ReadableStream({
      start: async (controller) => {
        const reader = response.body!.getReader();
        let buffered = "";

        const flush = async () => {
          if (!assemble || finalized || toolCallBuffers.size === 0) return;

          const sorted = Array.from(toolCallBuffers.entries()).sort(
            ([aIndex], [bIndex]) => aIndex - bIndex,
          );
          const toolCalls = sorted.map(([, call]) => call);

          const baseMessages = request?.messages || [];
          const repaired = this.repairOrNormalizeToolCalls(toolCalls, baseMessages);

          const finalChunk = {
            object: "chat.completion.chunk",
            choices: [
              {
                delta: { tool_calls: repaired },
                finish_reason: "tool_calls",
              },
            ],
          };

          const line = `data: ${JSON.stringify(finalChunk)}\n\n`;
          controller.enqueue(encoder.encode(line));
          finalized = true;
        };


        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, { stream: true });

            let newlineIndex;
            while ((newlineIndex = buffered.indexOf("\n")) >= 0) {
              const rawLine = buffered.slice(0, newlineIndex);
              buffered = buffered.slice(newlineIndex + 1);
              const line = rawLine.trimEnd();

              if (!line.startsWith("data:")) {
                controller.enqueue(encoder.encode(rawLine + "\n"));
                continue;
              }

              const dataPart = line.slice(5).trimStart();
              if (dataPart === "[DONE]") {
                await flush();
                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                break;
              }

              let parsed: any;
              try {
                parsed = JSON.parse(dataPart);
              } catch {
                controller.enqueue(encoder.encode(rawLine + "\n"));
                continue;
              }

              const choice = parsed.choices?.[0];
              const delta = choice?.delta;

              if (!assemble) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
                continue;
              }

              if (delta?.tool_calls && Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls as any[]) {
                  const index = tc.index ?? 0;
                  const existing = toolCallBuffers.get(index) || {
                    id: tc.id || "",
                    type: "function",
                    function: { name: "", arguments: "" },
                  };

                  if (typeof tc.id === "string" && tc.id.length) {
                    existing.id = tc.id;
                  }
                  if (tc.function?.name) {
                    existing.function.name = tc.function.name;
                  }
                  if (typeof tc.function?.arguments === "string") {
                    existing.function.arguments += tc.function.arguments;
                  }

                  if (!existing.id && existing.function.name) {
                    existing.id = `${idPrefix}.${existing.function.name}:${index}`;
                  }

                  toolCallBuffers.set(index, existing as ToolCall);
                }
                // Always emit original chunk while buffering
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
                continue;
              }

              if (choice?.finish_reason === "tool_calls") {
                await flush();
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
                continue;
              }

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
            }
          }

          await flush();
        } catch (err) {
          controller.error(err);
        } finally {
          reader.releaseLock();
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  /**
   * Check if response is a streaming response
   */
  private isStreamingResponse(response: Response): boolean {
    const contentType = response.headers.get("Content-Type") || "";
    return contentType.includes("text/event-stream") ||
           contentType.includes("application/x-ndjson");
  }

  // Final hook in the chain; Kimi-specific work happens in transformResponseOut.
  async transformResponseIn(response: Response, _context?: TransformerContext): Promise<Response> {
    if (!response) {
      throw new Error("Response is required");
    }
    return response;
  }
}
