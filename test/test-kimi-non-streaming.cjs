const { default: Server } = require('../dist/cjs/server.cjs');

// Test non-streaming tool calling functionality (public API, dist build)
async function testNonStreamingToolCalling() {
  console.log('Testing KimiTransformer non-streaming tool calling...\n');

  const server = new Server({ logger: false });

  setTimeout(async () => {
    const transformer = server.transformerService.getTransformer('Kimi');
    if (!transformer) {
      console.error('KimiTransformer not found');
      return;
    }

    console.log('KimiTransformer loaded successfully');
    console.log('Name:', transformer.name);
    console.log('Endpoint:', transformer.endPoint);

    // Test 1: transformRequestOut - tool_choice default setting
    console.log('\nTest 1: transformRequestOut - tool_choice default setting');
    const requestWithTools = {
      model: 'moonshot-v1-8k',
      messages: [{ role: 'user', content: 'Hello' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather information',
            parameters: {
              type: 'object',
              properties: { location: { type: 'string' } },
            },
          },
        },
      ],
    };

    try {
      const transformed = await transformer.transformRequestOut(requestWithTools, {});
      if (!transformed.tool_choice || transformed.tool_choice !== 'auto') {
        throw new Error('tool_choice was not defaulted to auto');
      }
      console.log('Test 1 passed');
    } catch (err) {
      console.error('Test 1 failed:', err.message);
    }

    // Test 2: transformRequestIn - acceptRoleTool validation
    console.log('Test 2: transformRequestIn - acceptRoleTool validation');
    const requestWithToolMessages = {
      model: 'moonshot-v1-8k',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'tool', tool_call_id: 'call_123', content: 'Weather is sunny' },
      ],
    };

    try {
      await transformer.transformRequestIn(requestWithToolMessages, { name: 'kimi' }, {});
      console.log('Test 2 passed');
    } catch (err) {
      console.error('Test 2 failed:', err.message);
    }

    // Test 3: transformResponseOut - native tool_calls handling (smoke test)
    console.log('Test 3: transformResponseOut - native tool_calls handling');
    const mockResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"Beijing"}',
                  },
                },
              ],
            },
          },
        ],
      }),
      clone() {
        return this;
      },
    };

    try {
      const ctx = { req: { body: { model: 'moonshot-v1-8k', messages: [] } } };
      await transformer.transformResponseOut(mockResponse, ctx);
      console.log('Test 3 passed');
    } catch (err) {
      console.error('Test 3 failed:', err.message);
    }

    // Test 4: ID normalization path smoke test
    console.log('Test 4: transformResponseOut - ID normalization');
    try {
      const ctx = { req: { body: { model: 'moonshot-v1-8k', messages: [] } } };
      const original = transformer.options || {};
      transformer.options = { ...original, idNormalization: true, idPrefix: 'functions' };
      const mockBad = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          choices: [
            {
              message: {
                content: 'x',
                tool_calls: [
                  {
                    id: 'bad',
                    type: 'function',
                    function: {
                      name: 'get_weather',
                      arguments: '{}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        clone() {
          return this;
        },
      };
      await transformer.transformResponseOut(mockBad, ctx);
      transformer.options = original;
      console.log('Test 4 passed');
    } catch (err) {
      console.error('Test 4 failed:', err.message);
    }

    console.log('All non-streaming tool calling tests completed');
  }, 100);
}

testNonStreamingToolCalling().catch(console.error);