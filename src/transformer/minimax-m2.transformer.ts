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

export interface MiniMaxM2TransformerOptions {
  // XML parsing configuration
  xmlParsing?: {
    strict?: boolean;
    maxDepth?: number;
    allowSelfClosing?: boolean;
    preserveWhitespace?: boolean;
  };

  // Thinking process markers
  thinkingMarkers?: {
    enabled?: boolean;
    startTag?: string;
    endTag?: string;
    extractToField?: boolean;
  };

  // ID generation strategy
  idGeneration?: {
    format?: "uuid" | "counter" | "function-based";
    prefix?: string;
    counterScope?: "conversation" | "request";
  };

  // OpenAI compatibility
  toolChoiceDefault?: "auto" | "none" | "required";
  acceptRoleTool?: boolean;
  enforceFinishReasonLoop?: boolean;

  // Streaming configuration
  assembleToolDeltas?: boolean;
  bufferIncompleteXML?: boolean;

  // Tool parsing
  manualToolParsing?: boolean;
  emitToolCallsInJson?: boolean;
}

export class MiniMaxM2Transformer implements Transformer {
  name = "MiniMax-M2";

  private options: MiniMaxM2TransformerOptions;

  // Cached regex patterns for XML parsing
  private regexCache: {
    invoke?: RegExp;
    parameter?: RegExp;
    thinking?: RegExp;
    id?: RegExp;
  } = {};

  constructor(options: MiniMaxM2TransformerOptions = {}) {
    this.options = options;
    const defaults: MiniMaxM2TransformerOptions = {
      xmlParsing: {
        strict: false,
        maxDepth: 10,
        allowSelfClosing: true,
        preserveWhitespace: false,
      },
      thinkingMarkers: {
        enabled: true,
        startTag: "<thinking>",
        endTag: "</thinking>",
        extractToField: true,
      },
      idGeneration: {
        format: "uuid",
        prefix: "minimax",
        counterScope: "conversation",
      },
      toolChoiceDefault: "auto",
      acceptRoleTool: true,
      enforceFinishReasonLoop: true,
      manualToolParsing: true,
      emitToolCallsInJson: false,
      assembleToolDeltas: false,
      bufferIncompleteXML: true,
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
    // Create a copy to avoid mutations
    const transformedRequest = { ...request };

    if (transformedRequest.tools && transformedRequest.tools.length > 0 && !transformedRequest.tool_choice) {
      transformedRequest.tool_choice = this.options.toolChoiceDefault;
    }

    if (this.options.acceptRoleTool) {
      for (const message of transformedRequest.messages) {
        if (message.role === "tool") {
          if (!message.tool_call_id || !message.content) {
            throw new Error("Tool messages must have tool_call_id and content");
          }
        }
      }
    }

    return transformedRequest;
  }

  async transformRequestOut(request: any, _context: TransformerContext): Promise<UnifiedChatRequest> {
    // MiniMax-M2 is OpenAI-compatible; preserve unified shape
    const body = { ...request };

    if (Array.isArray(body.tools) && body.tools.length > 0 && !body.tool_choice) {
      body.tool_choice = this.options.toolChoiceDefault;
    }

    return body;
  }

  async transformResponseOut(response: Response, context: TransformerContext): Promise<Response> {
    const request = context?.req?.body as UnifiedChatRequest | undefined;

    // Streaming: handle XML in streaming responses
    if (this.isStreamingResponse(response)) {
      return this.handleStreamingXML(response, request);
    }

    // Manual XML parsing for non-streaming responses
    if (this.options.manualToolParsing && request) {
      return this.handleManualXMLParsing(response, request);
    }

    // Default: pass through MiniMax-M2's OpenAI-compatible response unchanged
    return response;
  }

  private extractThinkingAndToolCalls(text: string): {
    thinking?: string;
    toolCalls: ToolCall[];
    cleanContent: string;
  } {
    if (!text || typeof text !== "string") {
      return { toolCalls: [], cleanContent: text };
    }

    const thinkingConfig = this.options.thinkingMarkers!;
    const toolCalls: ToolCall[] = [];
    let cleanContent = text;
    let thinking: string | undefined;

    try {
      // Extract thinking markers if enabled
      if (thinkingConfig.enabled) {
        const thinkingRegex = this.getRegexPatterns().thinking!;
        const thinkingMatch = text.match(thinkingRegex);
        if (thinkingMatch) {
          thinking = thinkingMatch[1].trim();
          // Remove thinking markers from content
          cleanContent = text.replace(thinkingRegex, "").trim();
        }
      }

      // Extract tool calls
      const invokeRegex = this.getRegexPatterns().invoke!;
      const parameterRegex = this.getRegexPatterns().parameter!;

      let invokeMatch;
      while ((invokeMatch = invokeRegex.exec(cleanContent)) !== null) {
        const invokeContent = invokeMatch[1];
        const toolCall = this.parseInvokeContent(invokeContent, parameterRegex);
        if (toolCall) {
          toolCalls.push(toolCall);
        }
      }

      // Remove tool calls from content
      if (toolCalls.length > 0) {
        const toolCallRegex = /<invoke[\s\S]*?<\/invoke>/g;
        cleanContent = cleanContent.replace(toolCallRegex, "").trim();
      }

    } catch (error) {
      console.error("Error parsing MiniMax-M2 content:", {
        error: error instanceof Error ? error.message : String(error),
        textLength: text?.length,
        textPreview: text?.substring(0, 200),
      });
      return { toolCalls: [], cleanContent: text };
    }

    return { thinking, toolCalls, cleanContent };
  }

  private parseInvokeContent(invokeContent: string, parameterRegex: RegExp): ToolCall | null {
    try {
      // Extract function name from name attribute
      const nameMatch = invokeContent.match(/name=["']([^"']+)["']/);
      if (!nameMatch) {
        return null;
      }

      const functionName = nameMatch[1];

      // Extract parameters
      const parameters: Record<string, any> = {};
      let parameterMatch;

      while ((parameterMatch = parameterRegex.exec(invokeContent)) !== null) {
        const paramContent = parameterMatch[1];
        const paramNameMatch = paramContent.match(/name=["']([^"']+)["']>([\s\S]*)/);

        if (paramNameMatch) {
          const paramName = paramNameMatch[1];
          let paramValue = paramNameMatch[2].trim();

          // Remove leading/trailing newlines
          if (paramValue.startsWith("\n")) {
            paramValue = paramValue.substring(1);
          }
          if (paramValue.endsWith("\n")) {
            paramValue = paramValue.slice(0, -1);
          }

          // Try to parse as JSON, fallback to string
          try {
            parameters[paramName] = JSON.parse(paramValue);
          } catch {
            parameters[paramName] = paramValue;
          }
        }
      }

      // Generate ID based on configuration
      const id = this.generateToolCallId(functionName);

      return {
        id,
        type: "function",
        function: {
          name: functionName,
          arguments: JSON.stringify(parameters),
        },
      };
    } catch (error) {
      console.warn("Error parsing invoke content:", error);
      return null;
    }
  }

  private generateToolCallId(functionName: string): string {
    const idConfig = this.options.idGeneration!;
    const prefix = idConfig.prefix || "minimax";

    switch (idConfig.format) {
      case "uuid":
        return `${prefix}.${functionName}.${this.generateUUID()}`;
      case "counter":
        // For counter-based IDs, we'd need to track state
        // This is a simplified implementation
        return `${prefix}.${functionName}.${Date.now()}`;
      case "function-based":
      default:
        return `${prefix}.${functionName}`;
    }
  }

  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  private getRegexPatterns() {
    const thinkingConfig = this.options.thinkingMarkers!;
    
    if (
      !this.regexCache.invoke ||
      !this.regexCache.parameter ||
      !this.regexCache.thinking
    ) {
      this.regexCache = {
        invoke: /<invoke name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/g,
        parameter: /<parameter name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/g,
        thinking: new RegExp(
          `${this.escapeRegex(thinkingConfig.startTag!)}([\\s\\S]*?)${this.escapeRegex(thinkingConfig.endTag!)}`,
          "g"
        ),
        id: /^[a-zA-Z0-9._-]+$/,
      };
    }
    return this.regexCache;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private async handleManualXMLParsing(
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
        const { thinking, toolCalls, cleanContent } = this.extractThinkingAndToolCalls(message.content);

        if (toolCalls.length > 0) {
          message.tool_calls = toolCalls;
          message.content = cleanContent;

          // Add thinking to message if configured
          if (thinking && this.options.thinkingMarkers!.extractToField) {
            (message as any).thinking = thinking;
          }

          if (this.options.enforceFinishReasonLoop) {
            if (choice) {
              choice.finish_reason = "tool_calls";
            }
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

  private handleStreamingXML(
    response: Response,
    request?: UnifiedChatRequest,
  ): Response {
    if (!response.body) return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const bufferIncompleteXML = this.options.bufferIncompleteXML === true;

    // Per-stream state
    let xmlBuffer = "";
    let finalized = false;

    const stream = new ReadableStream({
      start: async (controller) => {
        const reader = response.body!.getReader();
        let buffered = "";

        const flushXML = async () => {
          if (!bufferIncompleteXML || finalized || !xmlBuffer.trim()) return;

          try {
            const { toolCalls, cleanContent } = this.extractThinkingAndToolCalls(xmlBuffer);
            
            if (toolCalls.length > 0) {
              const finalChunk = {
                object: "chat.completion.chunk",
                choices: [
                  {
                    delta: { tool_calls: toolCalls },
                    finish_reason: "tool_calls",
                  },
                ],
              };

              const line = `data: ${JSON.stringify(finalChunk)}\n\n`;
              controller.enqueue(encoder.encode(line));
              finalized = true;
            }
          } catch (error) {
            console.warn("Error flushing XML buffer:", error);
          }
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
                await flushXML();
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

              // Buffer content for XML parsing if enabled
              if (bufferIncompleteXML && parsed.choices?.[0]?.delta?.content) {
                xmlBuffer += parsed.choices[0].delta.content;
              }

              controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
            }
          }

          await flushXML();
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

  private isStreamingResponse(response: Response): boolean {
    const contentType = response.headers.get("Content-Type") || "";
    return contentType.includes("text/event-stream") ||
           contentType.includes("application/x-ndjson");
  }

  async transformResponseIn(response: Response, _context?: TransformerContext): Promise<Response> {
    if (!response) {
      throw new Error("Response is required");
    }
    return response;
  }
}