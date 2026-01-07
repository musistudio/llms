import { UnifiedChatRequest } from "@/types/llm";
import { Transformer } from "@/types/transformer";

// This transformer extracts <think>...</think> segments from assistant outputs
// and emits them as separate thinking messages in both JSON and SSE streams.
export class ExtraThinkTagTransformer implements Transformer {
  name = "extrathinktag";

  async transformRequestIn(
    request: UnifiedChatRequest
  ): Promise<UnifiedChatRequest> {
    // Pass-through for requests; this transformer only affects responses.
    return request;
  }

  async transformResponseOut(response: Response): Promise<Response> {
    const thinkStartTag = "<think>";
    const thinkStopTag = "</think>";

    // Non-streaming JSON: extract <think> content if present on message.content
    if (response.headers.get("Content-Type")?.includes("application/json")) {
      try {
        const jsonResponse: any = await response.json();
        const content = jsonResponse?.choices?.[0]?.message?.content;
        if (typeof content === "string") {
          const match = content.match(/<think>([\s\S]*?)<\/think>/);
          if (match && match[1]) {
            jsonResponse.thinking = { content: match[1] };
          }
        }
        return new Response(JSON.stringify(jsonResponse), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        return response;
      }
    }

    // Streaming SSE: split <think> into thinking deltas and exclude from content
    if (response.headers.get("Content-Type")?.includes("stream")) {
      if (!response.body) return response;

      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      let contentIndex = 0;

      const stream = new ReadableStream({
        async start(controller) {
          const reader = response.body!.getReader();
          let lineBuffer = "";

          type FSM = "SEARCHING" | "THINKING" | "FINAL";
          let fsmState: FSM = "SEARCHING";
          let tagBuffer = ""; // stores partial tag matches across boundaries
          let finalBuffer = ""; // stores trailing newlines before real content

          const enqueueJSON = (obj: any) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          };

          const processAndEnqueue = (originalData: any, content: any) => {
            // Forward non-content deltas (e.g., tool_calls) untouched
            if (
              typeof content !== "string" &&
              originalData?.choices?.[0]?.delta &&
              Object.keys(originalData.choices[0].delta).length > 0 &&
              !originalData.choices[0].delta.content
            ) {
              originalData.choices[0].index = contentIndex;
              enqueueJSON(originalData);
              return;
            }

            if (typeof content !== "string") return;

            let currentContent = tagBuffer + content;
            tagBuffer = "";

            while (currentContent.length > 0) {
              if (fsmState === "SEARCHING") {
                const startTagIndex = currentContent.indexOf(thinkStartTag);
                if (startTagIndex !== -1) {
                  // Discard any content before <think>, then enter THINKING
                  currentContent = currentContent.substring(
                    startTagIndex + thinkStartTag.length
                  );
                  fsmState = "THINKING";
                } else {
                  // Keep possible partial start tag in buffer
                  for (let i = thinkStartTag.length - 1; i > 0; i--) {
                    if (currentContent.endsWith(thinkStartTag.substring(0, i))) {
                      tagBuffer = currentContent.substring(currentContent.length - i);
                      break;
                    }
                  }
                  currentContent = "";
                }
              } else if (fsmState === "THINKING") {
                const endTagIndex = currentContent.indexOf(thinkStopTag);
                if (endTagIndex !== -1) {
                  const thinkingPart = currentContent.substring(0, endTagIndex);
                  if (thinkingPart.length > 0) {
                    const newDelta = {
                      ...originalData.choices[0].delta,
                      thinking: { content: thinkingPart },
                    };
                    delete newDelta.content;
                    const thinkingChunk = {
                      ...originalData,
                      choices: [
                        { ...originalData.choices[0], delta: newDelta, index: contentIndex },
                      ],
                    };
                    enqueueJSON(thinkingChunk);
                  }

                  // Emit a signature to mark end of thinking
                  const signatureDelta = {
                    ...originalData.choices[0].delta,
                    thinking: { signature: Date.now().toString() },
                  };
                  delete signatureDelta.content;
                  const signatureChunk = {
                    ...originalData,
                    choices: [
                      { ...originalData.choices[0], delta: signatureDelta, index: contentIndex },
                    ],
                  };
                  enqueueJSON(signatureChunk);
                  contentIndex++;

                  // Move into FINAL state and continue after </think>
                  currentContent = currentContent.substring(
                    endTagIndex + thinkStopTag.length
                  );
                  fsmState = "FINAL";
                } else {
                  // No end tag yet; emit as thinking part but keep possible partial stop tag
                  let thinkingPart = currentContent;
                  for (let i = thinkStopTag.length - 1; i > 0; i--) {
                    if (currentContent.endsWith(thinkStopTag.substring(0, i))) {
                      tagBuffer = currentContent.substring(currentContent.length - i);
                      thinkingPart = currentContent.substring(0, currentContent.length - i);
                      break;
                    }
                  }
                  if (thinkingPart.length > 0) {
                    const newDelta = {
                      ...originalData.choices[0].delta,
                      thinking: { content: thinkingPart },
                    };
                    delete newDelta.content;
                    const thinkingChunk = {
                      ...originalData,
                      choices: [
                        { ...originalData.choices[0], delta: newDelta, index: contentIndex },
                      ],
                    };
                    enqueueJSON(thinkingChunk);
                  }
                  currentContent = "";
                }
              } else if (fsmState === "FINAL") {
                if (currentContent.length > 0) {
                  const isOnlyNewlines = /^\s*$/.test(currentContent);
                  if (isOnlyNewlines) {
                    finalBuffer += currentContent;
                  } else {
                    const finalPart = finalBuffer + currentContent;
                    const newDelta = {
                      ...originalData.choices[0].delta,
                      content: finalPart,
                    };
                    if ((newDelta as any).thinking) delete (newDelta as any).thinking;
                    const finalChunk = {
                      ...originalData,
                      choices: [{ ...originalData.choices[0], delta: newDelta }],
                    };
                    enqueueJSON(finalChunk);
                    finalBuffer = "";
                  }
                }
                contentIndex++;
                currentContent = "";
              }
            }
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              lineBuffer += chunk;
              const lines = lineBuffer.split("\n");
              lineBuffer = lines.pop() || "";

              for (const line of lines) {
                if (!line.trim()) continue;

                if (line.trim() === "data: [DONE]") {
                  controller.enqueue(encoder.encode(line + "\n\n"));
                  continue;
                }

                if (line.startsWith("data:")) {
                  try {
                    const data = JSON.parse(line.slice(5));
                    processAndEnqueue(
                      data,
                      data?.choices?.[0]?.delta?.content
                    );
                  } catch (e) {
                    controller.enqueue(encoder.encode(line + "\n"));
                  }
                } else {
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

            // If stream ends during thinking, emit a signature to close it
            if (fsmState === "THINKING") {
              const signatureChunk = {
                choices: [
                  {
                    delta: {
                      thinking: { signature: Date.now().toString() },
                    },
                  },
                ],
              };
              enqueueJSON(signatureChunk);
            }

            controller.close();
          }
        },
      });

      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    return response;
  }
}

