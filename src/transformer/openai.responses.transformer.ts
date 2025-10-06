import { UnifiedChatRequest } from "@/types/llm";
import { Transformer } from "@/types/transformer";

export class OpenAIResponsesTransformer implements Transformer {
  name = "openai-responses";
  endPoint = "/v1/responses";

  async transformRequestIn(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatRequest> {
    delete request.temperature;
    delete request.max_tokens;
    const system = request.messages.filter((msg) => msg.role === "system");
    if (system) {
      if (Array.isArray(system.content)) {
        request.instructions = system.content.join("\n\n");
      } else {
        request.instructions = system.content;
      }
    }
    const input = [];
    request.messages.forEach((message) => {
      if (message.role === "system") return;
      if (Array.isArray(message.content)) {
        message.content.forEach((content) => {
          if (content.type === "text") {
            if (message.role === "assistant") {
              content.type = "output_text";
            } else {
              content.type = "input_text";
            }
          } else if (content.type === "image_url") {
            content.type = "input_image";
            content.image_url = content.image_url.url;
            delete content.media_type;
          }
          delete content.cache_control;
        });
      }
      if (message.role === "tool") {
        message.type = "function_call_output";
        message.call_id = message.tool_call_id;
        message.output = message.content;
        delete message.cache_control;
        delete message.role;
        delete message.tool_call_id;
        delete message.content;
      } else if (message.role === "assistant") {
        if (Array.isArray(message.tool_calls)) {
          message.tool_calls.forEach((tool) => {
            input.push({
              type: "function_call",
              arguments: tool.function.arguments,
              name: tool.function.name,
              call_id: tool.id,
            });
          });
          return;
        }
      }
      input.push(message);
    });
    request.input = input;
    delete request.messages;
    if (Array.isArray(request.tools)) {
      const webSearch = request.tools?.find(
        (tool) => tool.function.name === "web_search"
      );
      request.tools = request.tools.map((tool) => {
        return {
          type: tool.type,
          ...tool.function,
        };
      });
      if (webSearch) {
        request.tools.push({
          type: "web_search_preview"
        });
      }
    }
    return request;
  }

  async transformResponseOut(response: Response): Promise<Response> {
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      const jsonResponse: any = await response.json();

      // 检查是否为responses API格式的JSON响应
      if (jsonResponse.object === "response" && jsonResponse.output) {
        // 将responses格式转换为chat格式
        const chatResponse = this.convertResponseToChat(jsonResponse);
        return new Response(JSON.stringify(chatResponse), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } else {
        // 不是responses API格式，保持原样
        return new Response(JSON.stringify(jsonResponse), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      }
    } else if (
      response.headers.get("Content-Type")?.includes("text/event-stream")
    ) {
      if (!response.body) {
        return response;
      }

      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = ""; // 用于缓冲不完整的数据
      let currentContent = "";
      let isStreamEnded = false;

      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body!.getReader();

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                if (!isStreamEnded) {
                  // 发送结束标记
                  const doneChunk = `data: [DONE]\n\n`;
                  controller.enqueue(encoder.encode(doneChunk));
                }
                break;
              }

              const chunk = decoder.decode(value, { stream: true });
              buffer += chunk;

              // 处理缓冲区中完整的数据行
              let lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || ""; // 最后一行可能不完整，保留在缓冲区

              for (const line of lines) {
                if (!line.trim()) continue;

                try {
                  if (line.startsWith("event: ")) {
                    // 处理事件行，暂存以便与下一行数据配对
                    continue;
                  } else if (line.startsWith("data: ")) {
                    const dataStr = line.slice(5).trim(); // 移除 "data: " 前缀
                    if (dataStr === "[DONE]") {
                      isStreamEnded = true;
                      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                      continue;
                    }

                    try {
                      const data = JSON.parse(dataStr);

                      // 根据不同的事件类型转换为chat格式
                      if (data.type === "response.output_text.delta") {
                        // 将output_text.delta转换为chat格式
                        currentContent += data.delta || "";

                        const chatChunk = {
                          id: data.item_id || "chatcmpl-" + Date.now(),
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model,
                          choices: [
                            {
                              index: data.output_index || 0,
                              delta: {
                                content: data.delta || "",
                              },
                              finish_reason: null,
                            },
                          ],
                        };

                        controller.enqueue(
                          encoder.encode(
                            `data: ${JSON.stringify(chatChunk)}\n\n`
                          )
                        );
                      } else if (
                        data.type === "response.output_item.added" &&
                        data.item?.type === "function_call"
                      ) {
                        // 处理function call开始 - 创建初始的tool call chunk
                        const functionCallChunk = {
                          id:
                            data.item.call_id ||
                            data.item.id ||
                            "chatcmpl-" + Date.now(),
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model || "gpt-5-codex-",
                          choices: [
                            {
                              index: data.output_index || 0,
                              delta: {
                                role: "assistant",
                                tool_calls: [
                                  {
                                    index: 0,
                                    id: data.item.call_id || data.item.id,
                                    function: {
                                      name: data.item.name || "",
                                      arguments: "",
                                    },
                                    type: "function",
                                  },
                                ],
                              },
                              finish_reason: null,
                            },
                          ],
                        };

                        controller.enqueue(
                          encoder.encode(
                            `data: ${JSON.stringify(functionCallChunk)}\n\n`
                          )
                        );
                      } else if (
                        data.type === "response.function_call_arguments.delta"
                      ) {
                        // 处理function call参数增量
                        const functionCallChunk = {
                          id: data.item_id || "chatcmpl-" + Date.now(),
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model || "gpt-5-codex-",
                          choices: [
                            {
                              index: data.output_index || 0,
                              delta: {
                                tool_calls: [
                                  {
                                    index: 0,
                                    function: {
                                      arguments: data.delta || "",
                                    },
                                  },
                                ],
                              },
                              finish_reason: null,
                            },
                          ],
                        };

                        controller.enqueue(
                          encoder.encode(
                            `data: ${JSON.stringify(functionCallChunk)}\n\n`
                          )
                        );
                      } else if (data.type === "response.completed") {
                        // 发送结束标记 - 检查是否是tool_calls完成
                        const finishReason = data.response?.output?.some(
                          (item: any) => item.type === "function_call"
                        )
                          ? "tool_calls"
                          : "stop";

                        const endChunk = {
                          id: data.response?.id || "chatcmpl-" + Date.now(),
                          object: "chat.completion.chunk",
                          created: Math.floor(Date.now() / 1000),
                          model: data.response?.model || "gpt-5-codex-",
                          choices: [
                            {
                              index: 0,
                              delta: {},
                              finish_reason: finishReason,
                            },
                          ],
                        };

                        controller.enqueue(
                          encoder.encode(
                            `data: ${JSON.stringify(endChunk)}\n\n`
                          )
                        );
                        isStreamEnded = true;
                      } else if (
                        data.type === "response.reasoning_summary_text.delta"
                      ) {
                        // 处理推理文本（如果需要的话，可以跳过或映射为特殊格式）
                        // 为了兼容性，我们可以将其忽略或作为特殊内容处理
                        continue;
                      }
                      // 其他事件类型暂时忽略，只处理文本内容
                    } catch (e) {
                      // 如果JSON解析失败，传递原始行
                      controller.enqueue(encoder.encode(line + "\n"));
                    }
                  } else {
                    // 传递其他行
                    controller.enqueue(encoder.encode(line + "\n"));
                  }
                } catch (error) {
                  console.error("Error processing line:", line, error);
                  // 如果解析失败，直接传递原始行
                  controller.enqueue(encoder.encode(line + "\n"));
                }
              }
            }

            // 处理缓冲区中剩余的数据
            if (buffer.trim()) {
              controller.enqueue(encoder.encode(buffer + "\n"));
            }

            // 确保流结束时发送结束标记
            if (!isStreamEnded) {
              const doneChunk = `data: [DONE]\n\n`;
              controller.enqueue(encoder.encode(doneChunk));
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
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    return response;
  }

  private convertResponseToChat(responseData: any): any {
    // 从output数组中提取不同类型的输出
    const messageOutput = responseData.output?.find(
      (item: any) => item.type === "message"
    );
    const functionCallOutput = responseData.output?.find(
      (item: any) => item.type === "function_call"
    );

    let messageContent = "";
    let toolCalls = null;

    if (messageOutput && messageOutput.content) {
      // 提取output_text类型的文本内容
      const textContent = messageOutput.content
        .filter((item: any) => item.type === "output_text")
        .map((item: any) => item.text)
        .join("");

      messageContent = textContent;
    }

    if (functionCallOutput) {
      // 处理function_call类型的输出
      toolCalls = [
        {
          id: functionCallOutput.call_id || functionCallOutput.id,
          function: {
            name: functionCallOutput.name,
            arguments: functionCallOutput.arguments,
          },
          type: "function",
        },
      ];
    }

    // 构建chat格式的响应
    const chatResponse = {
      id: responseData.id || "chatcmpl-" + Date.now(),
      object: "chat.completion",
      created: responseData.created_at,
      model: responseData.model || "gpt-4.1-2025-04-14", // 使用适当的默认模型名称
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: messageContent || null, // 如果有tool_calls，content可能是null
            tool_calls: toolCalls,
          },
          logprobs: null,
          finish_reason: toolCalls ? "tool_calls" : "stop",
        },
      ],
      usage: responseData.usage
        ? {
            prompt_tokens: responseData.usage.input_tokens || 0,
            completion_tokens: responseData.usage.output_tokens || 0,
            total_tokens: responseData.usage.total_tokens || 0,
          }
        : null,
    };

    return chatResponse;
  }
}
