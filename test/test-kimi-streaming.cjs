const { default: Server } = require('../dist/cjs/server.cjs');

// Streaming tests: exercise KimiTransformer only via built server & public API.

async function testStreamingToolCalling() {
  console.log('Testing KimiTransformer streaming tool calling...\n');

  const server = new Server({ logger: false });

  setTimeout(async () => {
    const kimi = server.transformerService.getTransformer('Kimi');
    if (!kimi) {
      console.error('KimiTransformer not found');
      return;
    }

    console.log('KimiTransformer loaded successfully');

    const run = async ({ bodyChunks, assembleToolDeltas }) => {
      const original = kimi.options || {};
      kimi.options = { ...original, assembleToolDeltas };
      try {
        const stream = new ReadableStream({
          start(controller) {
            for (const chunk of bodyChunks) {
              controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
          },
        });
        const res = {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'text/event-stream' }),
          body: stream,
        };
        const ctx = { req: { body: { model: 'moonshot-v1-8k', stream: true, messages: [] } } };
        return await kimi.transformResponseOut(res, ctx);
      } finally {
        kimi.options = original;
      }
    };

    // 1. Basic streaming detection (no crash)
    console.log('Test 1: isStreamingResponse detection');
    try {
      await run({ bodyChunks: ['data: {"choices":[{"delta":{"content":"x"}}]}\n\n'], assembleToolDeltas: false });
      console.log('Test 1 passed');
    } catch (err) {
      console.error('Test 1 failed:', err.message);
    }

    // 2. Passthrough mode
    console.log('Test 2: assembleToolDeltas = false (passthrough)');
    try {
      await run({
        assembleToolDeltas: false,
        bodyChunks: [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"t","arguments":"{}"}}]}}]}\n\n',
          'data: [DONE]\n\n',
        ],
      });
      console.log('Test 2 passed');
    } catch (err) {
      console.error('Test 2 failed:', err.message);
    }

    // 3. Assembly mode smoke test
    console.log('Test 3: assembleToolDeltas = true (assembly path)');
    try {
      await run({
        assembleToolDeltas: true,
        bodyChunks: [
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"get_weather","arguments":""}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"location\\":\\"Beijing\\"}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"functions.get_weather:0"}]}}]}\n\n',
          'data: {"choices":[{"finish_reason":"tool_calls"}]}\n\n',
          'data: [DONE]\n\n',
        ],
      });
      console.log('Test 3 passed');
    } catch (err) {
      console.error('Test 3 failed:', err.message);
    }

    // 4. Non-tool fields preservation smoke test
    console.log('Test 4: Non-tool SSE fields preservation');
    try {
      await run({
        assembleToolDeltas: true,
        bodyChunks: [
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"t","arguments":"{}"}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
          'data: [DONE]\n\n',
        ],
      });
      console.log('Test 4 passed');
    } catch (err) {
      console.error('Test 4 failed:', err.message);
    }

    console.log('All streaming tool calling tests completed');
  }, 100);
}

testStreamingToolCalling().catch(console.error);
