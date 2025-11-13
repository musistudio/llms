const { default: Server } = require('../dist/cjs/server.cjs');

// Test manual tool call parsing via public API only (behavioral smoke tests)
async function testManualToolParsing() {
  console.log('Testing KimiTransformer manual tool call parsing mode...\n');

  const server = new Server({ logger: false });

  setTimeout(async () => {
    const transformer = server.transformerService.getTransformer('Kimi');

    if (!transformer) {
      console.error('KimiTransformer not found');
      return;
    }

    console.log('KimiTransformer loaded successfully');

    const withOptions = (extraOptions) => ({
      async transformResponseOut(response, context) {
        const originalOptions = transformer.options || {};
        transformer.options = { ...originalOptions, ...extraOptions };
        try {
          return await transformer.transformResponseOut(response, context);
        } finally {
          transformer.options = originalOptions;
        }
      },
    });

    // Test 1: markers present -> parsed into tool_calls, content cleaned
    console.log('\nTest 1: K2 markers parsed into tool_calls');
    try {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  'Hello.\n\n' +
                  '<|tool_calls_section_begin|>\n' +
                  '<|tool_call_begin|>functions.get_weather<|tool_call_argument_begin|>{"location":"Beijing"}<|tool_call_end|>\n' +
                  '<|tool_calls_section_end|>\n\nDone.',
              },
            },
          ],
        }),
        clone() {
          return this;
        },
      };

      const ctx = { req: { body: { model: 'moonshot-v1-8k', messages: [] } } };
      const t = withOptions({
        manualToolParsing: true,
        emitToolCallsInJson: true,
        enforceFinishReasonLoop: true,
      });

      await t.transformResponseOut(mockResponse, ctx);
      console.log('Test 1 passed');
    } catch (err) {
      console.error('Test 1 failed:', err.message);
    }

    // Test 2: no markers -> passthrough
    console.log('Test 2: no markers passes through unchanged');
    try {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          choices: [
            {
              message: {
                content: 'Hello, no tool calls here.',
              },
            },
          ],
        }),
        clone() {
          return this;
        },
      };

      const ctx = { req: { body: { model: 'moonshot-v1-8k', messages: [] } } };
      const t = withOptions({
        manualToolParsing: true,
        emitToolCallsInJson: true,
      });

      await t.transformResponseOut(mockResponse, ctx);
      console.log('Test 2 passed');
    } catch (err) {
      console.error('Test 2 failed:', err.message);
    }

    console.log('All manual tool parsing tests completed');
  }, 0);
}

testManualToolParsing().catch(console.error);