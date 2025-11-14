# MiniMaxM2Transformer

## Overview

`MiniMaxM2Transformer` is a specialized transformer designed to handle the unique XML-based tool calling format and thinking process markers used by MiniMax-M2 models. It provides seamless integration with the unified LLM server interface while preserving MiniMax-M2's distinctive features.

## Key Features

- **XML-based Tool Calling**: Handles `<invoke name="...">` and `<parameter name="...">` tags
- **Thinking Process Extraction**: Processes `<thinking>...</thinking>` markers
- **Flexible ID Generation**: Supports UUID, counter, and function-based ID strategies
- **Streaming XML Support**: Handles incomplete XML tags in streaming responses
- **OpenAI Compatibility**: Maintains compatibility with OpenAI-style APIs

## Default Configuration

The transformer comes with sensible defaults optimized for MiniMax-M2:

| Option | Default | Purpose |
|--------|---------|---------|
| `xmlParsing.strict` | `false` | Allow flexible XML parsing |
| `xmlParsing.maxDepth` | `10` | Maximum XML nesting depth |
| `thinkingMarkers.enabled` | `true` | Enable thinking marker extraction |
| `thinkingMarkers.extractToField` | `true` | Extract thinking to separate field |
| `idGeneration.format` | `"uuid"` | Use UUID-based ID generation |
| `toolChoiceDefault` | `"auto"` | Auto-select tools when available |
| `manualToolParsing` | `true` | Enable manual XML parsing |
| `bufferIncompleteXML` | `true` | Buffer incomplete XML in streaming |

## Usage Examples

### Basic Configuration

For MiniMax-M2 models served by any OpenAI-compatible provider:

```json
{
  "name": "minimax-provider",
  "api_base_url": "https://api.minimax.chat/v1",
  "api_key": "your-minimax-key",
  "models": ["MiniMaxAI/MiniMax-M2"],
  "transformer": {
    "use": ["MiniMax-M2"]
  }
}
```

### Advanced Configuration

Customize XML parsing and thinking marker handling:

```json
{
  "name": "minimax-custom",
  "api_base_url": "https://api.minimax.chat/v1",
  "api_key": "your-minimax-key",
  "models": ["MiniMaxAI/MiniMax-M2"],
  "transformer": {
    "use": ["MiniMax-M2"],
    "options": {
      "xmlParsing": {
        "strict": false,
        "preserveWhitespace": true
      },
      "thinkingMarkers": {
        "enabled": true,
        "startTag": "<thinking>",
        "endTag": "</thinking>",
        "extractToField": true
      },
      "idGeneration": {
        "format": "uuid",
        "prefix": "minimax"
      },
      "bufferIncompleteXML": true
    }
  }
}
```

## XML Tool Calling Format

MiniMax-M2 uses XML-style tool calls that differ from OpenAI's JSON format:

### Input Format (Model Output)
```xml
Let me search for the latest announcements from OpenAI and Gemini.
<minimax:tool_call>
<invoke name="search_web">
<parameter name="query_tag">["technology", "events"]