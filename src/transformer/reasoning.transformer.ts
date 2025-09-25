import { UnifiedChatRequest } from "@/types/llm";
import { Transformer, TransformerOptions } from "../types/transformer";

export class ReasoningTransformer implements Transformer {
  static TransformerName = "reasoning";
  enable: any;

  constructor(private readonly options?: TransformerOptions) {
    this.enable = this.options?.enable ?? true;
  }

  async transformRequestOut(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatRequest> {
    if (!this.enable) {
      return request;
    }
    
    // Extract inline tokens from user messages and map to parameters
    if (request.messages) {
      const lastMessage = request.messages[request.messages.length - 1];
      if (lastMessage?.role === 'user' && typeof lastMessage.content === 'string') {
        const content = lastMessage.content;
        
        // Check for inline tokens at start of prompt
        const tokenMap = {
          'Quick:': { effort: 'low', verbosity: 'low' },
          'Deep:': { effort: 'high', verbosity: 'medium' },
          'Explain:': { effort: 'medium', verbosity: 'high' },
          'Brief:': { effort: 'medium', verbosity: 'low' }
        };
        
        // Check for hashtag tokens anywhere in prompt
        const hashtagMap = {
          '#quick': { effort: 'low', verbosity: 'low' },
          '#deep': { effort: 'high', verbosity: 'medium' },
          '#explain': { effort: 'medium', verbosity: 'high' },
          '#brief': { effort: 'medium', verbosity: 'low' }
        };
        
        let updatedContent = content;
        let foundToken = false;
        
        // Process prefix tokens (strip from beginning)
        for (const [token, params] of Object.entries(tokenMap)) {
          if (content.startsWith(token)) {
            if (!request.reasoning_effort) request.reasoning_effort = params.effort;
            if (!request.verbosity) request.verbosity = params.verbosity;
            updatedContent = content.substring(token.length).trim();
            foundToken = true;
            this.logger?.info({ token, params }, 'Applied reasoning token from prompt prefix');
            break;
          }
        }
        
        // Process hashtag tokens (strip from anywhere)
        for (const [hashtag, params] of Object.entries(hashtagMap)) {
          if (content.includes(hashtag)) {
            if (!request.reasoning_effort) request.reasoning_effort = params.effort;
            if (!request.verbosity) request.verbosity = params.verbosity;
            updatedContent = updatedContent.replace(hashtag, '').trim();
            foundToken = true;
            this.logger?.info({ hashtag, params }, 'Applied reasoning hashtag from prompt');
            break;
          }
        }
        
        // Update message content if we found and stripped tokens
        if (foundToken) {
          lastMessage.content = updatedContent;
        }
      }
    }
    
    
    // Convert Anthropic-style thinking to OpenAI reasoning.effort format
    if (request.thinking?.type === "enabled" || request.enable_thinking) {
      request.reasoning_effort = "medium"; // Default to medium effort
      // Clean up Anthropic thinking properties
      delete request.thinking;
      delete request.enable_thinking;
    }
    
    // Handle direct reasoning parameter from client (e.g., Claude Code)
    if (request.reasoning && typeof request.reasoning === 'object') {
      // If it has max_tokens (old format), convert to effort format
      if ('max_tokens' in request.reasoning) {
        const maxTokens = request.reasoning.max_tokens;
        // Map token budget to effort level
        const effort = maxTokens > 1000 ? "high" : maxTokens > 500 ? "medium" : "minimal";
        request.reasoning_effort = effort;
      }
      // If it already has effort, convert to flat format
      else if ('effort' in request.reasoning) {
        request.reasoning_effort = request.reasoning.effort;
      }
      // If it has some other format, remove it entirely to avoid API error
      else {
        delete request.reasoning;
      }
      
      // Always remove the old reasoning object after processing
      delete request.reasoning;
    }
    
    
    return request;
  }

  async transformResponseOut(response: Response): Promise<Response> {
    if (!this.enable) return response;
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const jsonResponse = await response.json();
      
      // Debug: Log response structure using Fastify logger
      this.logger?.info({
        responseKeys: Object.keys(jsonResponse),
        messageKeys: jsonResponse.choices?.[0]?.message ? Object.keys(jsonResponse.choices[0].message) : 'none',
        hasReasoning: !!jsonResponse.choices?.[0]?.message?.reasoning,
        hasReasoningContent: !!jsonResponse.choices?.[0]?.message?.reasoning_content,
        reasoningTokens: jsonResponse.usage?.completion_tokens_details?.reasoning_tokens,
        model: jsonResponse.model
      }, 'REASONING TRANSFORMER RESPONSE DEBUG');
      
      // Handle non-streaming response with reasoning content (GPT-5 format)
      const message = jsonResponse.choices?.[0]?.message;
      const reasoningContent = message?.reasoning_content || message?.reasoning;
      
      if (reasoningContent) {
        // Convert to Anthropic thinking format
        const thinkingResponse = {
          ...jsonResponse,
          choices: [
            {
              ...jsonResponse.choices[0],
              message: {
                ...message,
                content: [
                  {
                    type: "thinking",
                    content: reasoningContent
                  },
                  {
                    type: "text", 
                    text: message.content || ""
                  }
                ]
              }
            }
          ]
        };
        
        // Remove original reasoning fields
        delete thinkingResponse.choices[0].message.reasoning;
        delete thinkingResponse.choices[0].message.reasoning_content;
        
        this.logger?.info({
          reasoningLength: reasoningContent.length,
          convertedToThinking: true,
          model: jsonResponse.model
        }, "✅ REASONING CONTENT EXTRACTED AND CONVERTED TO THINKING FORMAT");
        
        return new Response(JSON.stringify(thinkingResponse), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
      
      return new Response(JSON.stringify(jsonResponse), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } else if (response.headers.get("Content-Type")?.includes("stream")) {
      if (!response.body) {
        return response;
      }

      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let reasoningContent = "";
      let isReasoningComplete = false;
      let buffer = ""; // Buffer for incomplete data

      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body!.getReader();

          // Process buffer function
          const processBuffer = (
            buffer: string,
            controller: ReadableStreamDefaultController,
            encoder: TextEncoder
          ) => {
            const lines = buffer.split("\n");
            for (const line of lines) {
              if (line.trim()) {
                controller.enqueue(encoder.encode(line + "\n"));
              }
            }
          };

          // Process line function
          const processLine = (
            line: string,
            context: {
              controller: ReadableStreamDefaultController;
              encoder: typeof TextEncoder;
              reasoningContent: () => string;
              appendReasoningContent: (content: string) => void;
              isReasoningComplete: () => boolean;
              setReasoningComplete: (val: boolean) => void;
            }
          ) => {
            const { controller, encoder } = context;

            this.logger?.debug({ line }, `Processing reason line`);

            if (line.startsWith("data: ") && line.trim() !== "data: [DONE]") {
              try {
                const data = JSON.parse(line.slice(6));

                // Extract reasoning_content from delta
                if (data.choices?.[0]?.delta?.reasoning_content) {
                  context.appendReasoningContent(
                    data.choices[0].delta.reasoning_content
                  );
                  const thinkingChunk = {
                    ...data,
                    choices: [
                      {
                        ...data.choices[0],
                        delta: {
                          ...data.choices[0].delta,
                          thinking: {
                            content: data.choices[0].delta.reasoning_content,
                          },
                        },
                      },
                    ],
                  };
                  delete thinkingChunk.choices[0].delta.reasoning_content;
                  const thinkingLine = `data: ${JSON.stringify(
                    thinkingChunk
                  )}\n\n`;
                  controller.enqueue(encoder.encode(thinkingLine));
                  return;
                }

                // Check if reasoning is complete (when delta has content but no reasoning_content)
                if (
                  (data.choices?.[0]?.delta?.content ||
                    data.choices?.[0]?.delta?.tool_calls) &&
                  context.reasoningContent() &&
                  !context.isReasoningComplete()
                ) {
                  context.setReasoningComplete(true);
                  const signature = Date.now().toString();

                  // Create a new chunk with thinking block
                  const thinkingChunk = {
                    ...data,
                    choices: [
                      {
                        ...data.choices[0],
                        delta: {
                          ...data.choices[0].delta,
                          content: null,
                          thinking: {
                            content: context.reasoningContent(),
                            signature: signature,
                          },
                        },
                      },
                    ],
                  };
                  delete thinkingChunk.choices[0].delta.reasoning_content;
                  // Send the thinking chunk
                  const thinkingLine = `data: ${JSON.stringify(
                    thinkingChunk
                  )}\n\n`;
                  controller.enqueue(encoder.encode(thinkingLine));
                }

                if (data.choices?.[0]?.delta?.reasoning_content) {
                  delete data.choices[0].delta.reasoning_content;
                }

                // Send the modified chunk
                if (
                  data.choices?.[0]?.delta &&
                  Object.keys(data.choices[0].delta).length > 0
                ) {
                  if (context.isReasoningComplete()) {
                    data.choices[0].index++;
                  }
                  const modifiedLine = `data: ${JSON.stringify(data)}\n\n`;
                  controller.enqueue(encoder.encode(modifiedLine));
                }
              } catch (e) {
                // If JSON parsing fails, pass through the original line
                controller.enqueue(encoder.encode(line + "\n"));
              }
            } else {
              // Pass through non-data lines (like [DONE])
              controller.enqueue(encoder.encode(line + "\n"));
            }
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                // Process remaining data in buffer
                if (buffer.trim()) {
                  processBuffer(buffer, controller, encoder);
                }
                break;
              }

              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;

              // Process complete lines from buffer
              const lines = buffer.split("\n");
              buffer = lines.pop() || ""; // Keep incomplete line in buffer

              for (const line of lines) {
                if (!line.trim()) continue;

                try {
                  processLine(line, {
                    controller,
                    encoder: encoder,
                    reasoningContent: () => reasoningContent,
                    appendReasoningContent: (content) =>
                      (reasoningContent += content),
                    isReasoningComplete: () => isReasoningComplete,
                    setReasoningComplete: (val) => (isReasoningComplete = val),
                  });
                } catch (error) {
                  console.error("Error processing line:", line, error);
                  // Pass through original line if parsing fails
                  controller.enqueue(encoder.encode(line + "\n"));
                }
              }
            }
          } catch (error) {
            console.error("Stream error:", error);
            controller.error(error);
          } finally {
            try {
              reader.releaseLock();
            } catch (e) {
              console.error("Error releasing reader lock:", e);
            }
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

    return response;
  }
}
