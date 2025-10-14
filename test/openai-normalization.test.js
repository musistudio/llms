import { test } from 'node:test';
import assert from 'node:assert';

// Mock the OpenAI transformer
class OpenAITransformer {
  constructor() {}

  normalizeImageContent(content) {
    // Handle Anthropic 'image' type conversion
    if (content.type === 'image' && content.source) {
      const url = content.source.type === 'base64' 
        ? `data:${content.source.media_type};base64,${content.source.data}`
        : content.source.url;
      
      return {
        type: 'image_url',
        image_url: {
          url: url,
          detail: 'high'
        }
      };
    }
    
    // Handle image_url type with extra fields
    if (content.type === 'image_url') {
      const normalized = {
        type: 'image_url',
        image_url: {
          url: content.image_url?.url || content.url,
          detail: content.image_url?.detail || 'high'
        }
      };
      
      // Remove all extra fields - only keep type and image_url
      return normalized;
    }
    
    return content;
  }

  normalizeToolMessages(messages) {
    const normalized = [];
    let lastToolCallId = null;
    
    for (const msg of messages) {
      // Track tool call IDs from assistant messages
      if (msg.role === 'assistant' && msg.content && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'tool_use' && part.id) {
            lastToolCallId = part.id;
          }
        }
        normalized.push(msg);
        continue;
      }
      
      // Handle messages with content arrays
      if (msg.content && Array.isArray(msg.content)) {
        const hasToolResult = msg.content.some(c => 
          c.type === 'tool_result' || c.type === 'server_tool_use'
        );
        
        if (hasToolResult) {
          // Extract tool results and create separate tool messages
          for (const part of msg.content) {
            if (part.type === 'tool_result') {
              normalized.push({
                role: 'tool',
                tool_call_id: part.tool_use_id,
                content: typeof part.content === 'string' 
                  ? part.content 
                  : JSON.stringify(part.content)
              });
            } else if (part.type === 'server_tool_use') {
              // Use the last tool call ID from assistant message
              normalized.push({
                role: 'tool',
                tool_call_id: lastToolCallId || part.id.replace('srvtoolu_', 'call_'),
                content: JSON.stringify(part.result || {})
              });
            }
          }
          
          // Filter out tool results from the original message
          const nonToolContent = msg.content.filter(c => 
            c.type !== 'tool_result' && c.type !== 'server_tool_use'
          );
          
          if (nonToolContent.length > 0) {
            normalized.push({
              ...msg,
              content: nonToolContent
            });
          }
        } else {
          normalized.push(msg);
        }
      } else {
        normalized.push(msg);
      }
    }
    
    return normalized;
  }

  async transformRequestOut(request) {
    // Main transformation logic
    // Fix A: Normalize image content in messages
    if (request.messages) {
      request.messages = request.messages.map(msg => {
        if (msg.content && Array.isArray(msg.content)) {
          msg.content = msg.content.map(part => {
            if (part.type === 'image_url' || part.type === 'image') {
              return this.normalizeImageContent(part);
            }
            return part;
          });
        }
        return msg;
      });
    }

    // Fix B: Convert tool result messages
    if (request.messages) {
      request.messages = this.normalizeToolMessages(request.messages);
    }

    // Existing transformations...
    if (request.max_tokens) {
      request.max_completion_tokens = request.max_tokens;
      delete request.max_tokens;
    }

    return request;
  }
}

// TDD Tests for Fix A: Image Format Normalization
test('Fix A: Should normalize Anthropic image format to strict OpenAI format', async (t) => {
  const transformer = new OpenAITransformer();
  
  // Test case: Anthropic format with extra fields
  const anthropicImage = {
    type: 'image_url',
    image_url: {
      url: 'data:image/png;base64,abc123'
    },
    media_type: 'image/png',  // Extra field that OpenAI rejects
    title: 'Screenshot',       // Extra field
    width: 1024,              // Extra field
    height: 768               // Extra field
  };

  const normalized = transformer.normalizeImageContent(anthropicImage);
  
  // Should only have type and image_url fields
  assert.deepStrictEqual(Object.keys(normalized).sort(), ['image_url', 'type']);
  assert.strictEqual(normalized.type, 'image_url');
  assert.strictEqual(normalized.image_url.url, 'data:image/png;base64,abc123');
  assert.strictEqual(normalized.image_url.detail, 'high');
});

test('Fix A: Should add detail field if missing', async (t) => {
  const transformer = new OpenAITransformer();
  
  const imageWithoutDetail = {
    type: 'image_url',
    image_url: {
      url: 'https://example.com/image.png'
    }
  };

  const normalized = transformer.normalizeImageContent(imageWithoutDetail);
  
  assert.strictEqual(normalized.image_url.detail, 'high');
});

test('Fix A: Should handle Anthropic image type conversion', async (t) => {
  const transformer = new OpenAITransformer();
  
  // Anthropic sometimes uses type: "image" instead of "image_url"
  const anthropicImage = {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: 'base64data'
    }
  };

  const normalized = transformer.normalizeImageContent(anthropicImage);
  
  assert.strictEqual(normalized.type, 'image_url');
  assert.strictEqual(normalized.image_url.url, 'data:image/jpeg;base64,base64data');
});

// TDD Tests for Fix B: Tool Call ID Mapping
test('Fix B: Should convert server_tool_use to proper tool message', async (t) => {
  const transformer = new OpenAITransformer();
  
  const messages = [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'call_abc123',
          name: 'get_weather',
          input: { location: 'NYC' }
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'server_tool_use',
          id: 'srvtoolu_xyz789',  // This pattern causes the error
          result: { temperature: 72 }
        }
      ]
    }
  ];

  const normalized = transformer.normalizeToolMessages(messages);
  
  // Should have a separate tool message
  assert.strictEqual(normalized.length, 2);
  assert.strictEqual(normalized[1].role, 'tool');
  assert.strictEqual(normalized[1].tool_call_id, 'call_abc123');
  assert.strictEqual(typeof normalized[1].content, 'string');
  assert.strictEqual(normalized[1].content, '{"temperature":72}');
});

test('Fix B: Should handle tool_result content type', async (t) => {
  const transformer = new OpenAITransformer();
  
  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_def456',
          content: 'Result data'
        }
      ]
    }
  ];

  const normalized = transformer.normalizeToolMessages(messages);
  
  assert.strictEqual(normalized[0].role, 'tool');
  assert.strictEqual(normalized[0].tool_call_id, 'call_def456');
  assert.strictEqual(normalized[0].content, 'Result data');
});

test('Fix B: Should not modify regular messages', async (t) => {
  const transformer = new OpenAITransformer();
  
  const messages = [
    {
      role: 'user',
      content: 'Hello'
    },
    {
      role: 'assistant',
      content: 'Hi there!'
    }
  ];

  const normalized = transformer.normalizeToolMessages(messages);
  
  assert.deepStrictEqual(normalized, messages);
});

// Integration test
test('Integration: Full request transformation', async (t) => {
  const transformer = new OpenAITransformer();
  
  const request = {
    model: 'gpt-5',
    max_tokens: 100,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this image'
          },
          {
            type: 'image_url',
            image_url: { url: 'https://example.com/img.png' },
            media_type: 'image/png',
            extra_field: 'should be removed'
          }
        ]
      }
    ]
  };

  const transformed = await transformer.transformRequestOut(request);
  
  // Check max_tokens conversion
  assert.strictEqual(transformed.max_completion_tokens, 100);
  assert.strictEqual(transformed.max_tokens, undefined);
  
  // Check image normalization
  const imageContent = transformed.messages[0].content[1];
  assert.deepStrictEqual(Object.keys(imageContent).sort(), ['image_url', 'type']);
  assert.strictEqual(imageContent.image_url.detail, 'high');
});

console.log('Running OpenAI normalization tests...');