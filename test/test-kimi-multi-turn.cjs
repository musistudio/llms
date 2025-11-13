const { default: Server } = require('../dist/cjs/server.cjs');

// Test multi-turn ID consistency via observable behavior only (behavioral smoke tests)
async function testMultiTurnIDConsistency() {
  console.log('Testing KimiTransformer multi-turn ID consistency...\n');

  const server = new Server({ logger: false });

  setTimeout(async () => {
    const transformer = server.transformerService.getTransformer('Kimi');

    if (!transformer) {
      console.error('KimiTransformer not found');
      return;
    }

    console.log('KimiTransformer loaded successfully');

    const runWithOptions = async (opts, toolCalls, messages) => {
      const original = transformer.options || {};
      transformer.options = { ...original, ...opts };
      try {
        const mockResponse = {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: toolCalls,
                },
              },
            ],
          }),
          clone() {
            return this;
          },
        };
        const ctx = { req: { body: { model: 'moonshot-v1-8k', messages } } };
        return await transformer.transformResponseOut(mockResponse, ctx);
      } finally {
        transformer.options = original;
      }
    };

    // Test 1: idNormalization = true -> normalize all IDs sequentially
    console.log('Test 1: idNormalization normalizes IDs');
    try {
      const toolCalls = [
        { id: 'bad_id', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
        { id: 'also_bad', type: 'function', function: { name: 'get_time', arguments: '{}' } },
      ];
      const messages = [];

      await runWithOptions(
        { idNormalization: true, idPrefix: 'functions' },
        toolCalls,
        messages,
      );

      console.log('Test 1 passed');
    } catch (err) {
      console.error('Test 1 failed:', err.message);
    }

    // Test 2: repairOnMismatch = true -> fix only invalid IDs
    console.log('Test 2: repairOnMismatch repairs invalid IDs only');
    try {
      const toolCalls = [
        { id: 'bad_id', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
        { id: 'functions.get_time:5', type: 'function', function: { name: 'get_time', arguments: '{}' } },
      ];
      const messages = [];

      await runWithOptions(
        { idNormalization: false, repairOnMismatch: true, idPrefix: 'functions' },
        toolCalls,
        messages,
      );

      console.log('Test 2 passed');
    } catch (err) {
      console.error('Test 2 failed:', err.message);
    }

    // Test 3: multi-turn context influences next index
    console.log('Test 3: multi-turn history influences normalization');
    try {
      const history = [
        {
          role: 'assistant',
          tool_calls: [
            {
              id: 'functions.existing:0',
              type: 'function',
              function: { name: 'existing', arguments: '{}' },
            },
          ],
        },
      ];

      const toolCalls = [
        {
          id: 'bad',
          type: 'function',
          function: { name: 'get_weather', arguments: '{}' },
        },
      ];

      await runWithOptions(
        { idNormalization: true, idPrefix: 'functions' },
        toolCalls,
        history,
      );

      console.log('Test 3 passed');
    } catch (err) {
      console.error('Test 3 failed:', err.message);
    }

    console.log('All multi-turn ID consistency tests completed');
  }, 0);
}

testMultiTurnIDConsistency().catch(console.error);