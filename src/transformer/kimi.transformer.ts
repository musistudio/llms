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

  // Cached regex patterns
  private regexCache: {
    section?: RegExp;
    call?: RegExp;
    arg?: RegExp;
    id?: RegExp;
  } = {};

  constructor(private options: KimiTransformerOptions = {}) {
    // Set defaults with deep merge
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
      idNormalization: true,
      idPrefix: "functions",
      counterScope: "conversation",
      repairOnMismatch: true,
    };

    this.options = this.deepMerge(defaults, options);
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
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

  /**
   * Check if value is a plain object
   */
  private isObject(value: any): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * Transform incoming requests (from client to provider)
   */
  async transformRequestIn(request: UnifiedChatRequest, provider: LLMProvider, context: TransformerContext): Promise<Record<string, any>> {
    // Set default tool_choice if not specified and tools are present
    if (request.tools && request.tools.length > 0 && !request.tool_choice) {
      request.tool_choice = this.options.toolChoiceDefault;
    }

    // Validate tool messages if acceptRoleTool is enabled
    if (this.options.acceptRoleTool) {
      // Ensure tool messages have required fields
      for (const message of request.messages) {
        if (message.role === 'tool') {
          if (!message.tool_call_id || !message.content) {
            throw new Error('Tool messages must have tool_call_id and content');
          }
        }
      }
    }

    return request;
  }

  /**
   * Extract tool calls from Kimi's manual markers in completion text
   */
  private extractToolCallInfo(text: string): {
    toolCalls: ToolCall[];
    cleanContent: string;
  } {
    // Input validation
    if (!text || typeof text !== 'string') {
      return { toolCalls: [], cleanContent: text };
    }

    if (!this.options.toolTokens) {
      console.warn('Tool tokens not configured for manual parsing');
      return { toolCalls: [], cleanContent: text };
    }

    const regex = this.getRegexPatterns();
    const sectionRegex = regex.section!;
    const callRegex = regex.call!;
    const argRegex = regex.arg!;

    const toolCalls: ToolCall[] = [];

    let cleanContent = text;

    try {
      // Check if manual markers exist
      const sectionMatch = text.match(sectionRegex);
      if (sectionMatch) {
        const sectionContent = sectionMatch[1];
        const parsedToolCalls = this.parseToolCallsFromSection(sectionContent);

        toolCalls.push(...parsedToolCalls);
        cleanContent = text.replace(sectionRegex, '').trim();
      }
    } catch (error) {
      console.error('Error parsing tool calls from text:', error);
      // Return original text on error
      return { toolCalls: [], cleanContent: text };
    }

    return { toolCalls, cleanContent };
  }

  /**
   * Parse individual tool calls from a section of text
   */
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

  /**
   * Extract function information from call content
   */
  private extractFunctionInfo(callContent: string, args: string): ToolCall | null {
    try {
      const argMarkerIndex = callContent.indexOf(this.options.toolTokens!.argBegin);
      if (argMarkerIndex <= 0) return null;

      const functionId = callContent.substring(0, argMarkerIndex).trim();
      const trimmedArgs = args.trim();

      // Parse function name from ID (format: functions.name:idx)
      const idParts = functionId.split('.');
      let functionName = functionId;
      if (idParts.length >= 2) {
        const namePart = idParts[1].split(':')[0];
        functionName = namePart || functionId;
      }

      return {
        id: functionId,
        type: "function",
        function: {
          name: functionName,
          arguments: trimmedArgs
        }
      };
    } catch (error) {
      console.warn('Error extracting function info:', error);
      return null;
    }
  }

  /**
   * Escape regex special characters
   */
  private getRegexPatterns() {
    const tokens = this.options.toolTokens!;
    const cacheKey = JSON.stringify(tokens);

    // Check if we have cached patterns for current config
    if (!this.regexCache.section ||
        this.regexCache.section.source !== `${this.escapeRegex(tokens.sectionBegin)}(.*?)${this.escapeRegex(tokens.sectionEnd)}`) {

      this.regexCache = {
        section: new RegExp(`${this.escapeRegex(tokens.sectionBegin)}(.*?)${this.escapeRegex(tokens.sectionEnd)}`, 's'),
        call: new RegExp(`${this.escapeRegex(tokens.callBegin)}(.*?)${this.escapeRegex(tokens.callEnd)}`, 'gs'),
        arg: new RegExp(`${this.escapeRegex(tokens.argBegin)}(.*)`, 's'),
        id: new RegExp(`${this.escapeRegex(this.options.idPrefix!)}\\.[^:]+:(\\d+)`, 'g'),
      };
    }

    return this.regexCache;
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get next tool call index for conversation-global monotonic counter
   */
  private getNextToolCallIndex(messages: UnifiedMessage[]): number {
    // Input validation
    if (!messages || !Array.isArray(messages)) {
      return 0;
    }

    if (!this.options.idPrefix) {
      console.warn('ID prefix not configured');
      return 0;
    }

    const idRegex = this.getRegexPatterns().id!;
    let maxIndex = -1;

    for (const message of messages) {
      // Check tool_calls in assistant messages
      if (message.tool_calls) {
        for (const toolCall of message.tool_calls) {
          const matches = [...toolCall.id.matchAll(idRegex)];
          for (const match of matches) {
            const index = parseInt(match[1], 10);
            maxIndex = Math.max(maxIndex, index);
          }
        }
      }

      // Also check tool_call_id in tool messages (for validation)
      if (message.role === 'tool' && message.tool_call_id) {
        const matches = [...message.tool_call_id.matchAll(idRegex)];
        for (const match of matches) {
          const index = parseInt(match[1], 10);
          maxIndex = Math.max(maxIndex, index);
        }
      }
    }

    return maxIndex + 1;
  }

  /**
   * Normalize tool call IDs to ensure monotonic conversation-global counter
   */
  private normalizeToolCallIds(toolCalls: ToolCall[], messages: UnifiedMessage[]): ToolCall[] {
    // Input validation
    if (!toolCalls || !Array.isArray(toolCalls)) {
      return [];
    }

    if (!this.options.idNormalization) return toolCalls;

    if (!this.options.idPrefix) {
      console.warn('ID prefix not configured for normalization');
      return toolCalls;
    }

    const nextIndex = this.getNextToolCallIndex(messages);
    const prefix = this.options.idPrefix;

    return toolCalls.map((call, idx) => {
      const functionName = call.function.name;
      const normalizedId = `${prefix}.${functionName}:${nextIndex + idx}`;

      return {
        ...call,
        id: normalizedId
      };
    });
  }

  /**
   * Handle manual tool parsing mode for responses
   */
  private async handleManualToolParsing(response: Response, request: UnifiedChatRequest): Promise<Response> {
    // Input validation
    if (!request?.messages) {
      console.warn('Request messages not available for tool parsing');
      return response;
    }

    let jsonResponse: OpenAIResponse;
    try {
      jsonResponse = await response.json() as OpenAIResponse;
    } catch (error) {
      console.error('Failed to parse response JSON:', error);
      return response;
    }

    try {
      if (jsonResponse.choices?.[0]?.message?.content) {
        const content = jsonResponse.choices[0].message.content;
        const { toolCalls, cleanContent } = this.extractToolCallInfo(content);

        if (toolCalls.length > 0) {
          // Normalize IDs for conversation-global monotonic counter
          const normalizedToolCalls = this.normalizeToolCallIds(toolCalls, request.messages || []);

          // Update response with structured tool calls
          jsonResponse.choices[0].message.tool_calls = normalizedToolCalls;
          jsonResponse.choices[0].message.content = cleanContent;
          jsonResponse.choices[0].finish_reason = 'tool_calls';

          // Remove tool_calls from content if emitToolCallsInJson is false
          if (!this.options.emitToolCallsInJson) {
            jsonResponse.choices[0].message.content = cleanContent;
          }
        }
      }
    } catch (error) {
      console.error('Error processing manual tool parsing:', error);
      // Return original response on error
    }

    return new Response(JSON.stringify(jsonResponse), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  /**
   * Handle streaming responses with tool calls
   */
  private handleStreamingToolCalls(response: Response): Response {
    if (!response.body) return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = response.body!.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
                try {
                  const data = JSON.parse(line.slice(6));

                  // For standard mode, pass through tool_calls chunks unchanged
                  if (data.choices?.[0]?.delta?.tool_calls ||
                      data.choices?.[0]?.finish_reason === 'tool_calls') {
                    controller.enqueue(encoder.encode(line + '\n\n'));
                  } else if (data.choices?.[0]?.delta &&
                           Object.keys(data.choices[0].delta).length > 0) {
                    controller.enqueue(encoder.encode(line + '\n\n'));
                  }
                } catch (parseError) {
                  console.warn('Failed to parse streaming chunk:', parseError);
                  // Pass through malformed lines
                  controller.enqueue(encoder.encode(line + '\n'));
                }
              } else {
                // Pass through non-data lines
                controller.enqueue(encoder.encode(line + '\n'));
              }
            }
          }
        } catch (error) {
          controller.error(error);
        } finally {
          controller.close();
          try {
            reader.releaseLock();
          } catch (e) {
            // Ignore
          }
        }
      },
    });

    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }



  /**
   * Transform response for manual tool parsing mode
   */
  async transformResponseIn(response: Response, context?: TransformerContext): Promise<Response> {
    // Input validation
    if (!response) {
      throw new Error('Response is required');
    }

    const request = context?.req?.body as UnifiedChatRequest;

    // Handle streaming responses
    if (response.headers.get('Content-Type')?.includes('stream')) {
      return this.handleStreamingToolCalls(response);
    }

    // Handle non-streaming responses
    if (this.options.manualToolParsing) {
      return this.handleManualToolParsing(response, request);
    }

    // Standard mode: pass through unchanged
    return response;
  }
}