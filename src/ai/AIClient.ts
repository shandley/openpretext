/**
 * AIClient — thin wrapper around the Anthropic Messages API.
 *
 * Makes direct browser fetch calls with the dangerous-direct-browser-access
 * header. The API key is provided at construction time.
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 4096;

export class AIAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIAuthError';
  }
}

export class AIRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIRateLimitError';
  }
}

export class AIError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'AIError';
  }
}

export interface AIResponse {
  content: Array<{ type: string; text?: string }>;
}

export class AIClient {
  constructor(private apiKey: string) {}

  async analyze(
    imageBase64: string,
    systemPrompt: string,
    userMessage: string,
  ): Promise<string> {
    const body = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: imageBase64,
              },
            },
            {
              type: 'text',
              text: userMessage,
            },
          ],
        },
      ],
    };

    let response: Response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': API_VERSION,
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      throw new AIError(`Network error: ${err.message ?? 'fetch failed'}`);
    }

    if (response.status === 401) {
      throw new AIAuthError('Invalid API key. Check your Anthropic API key and try again.');
    }
    if (response.status === 429) {
      throw new AIRateLimitError('Rate limit exceeded. Please wait a moment and try again.');
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AIError(`API error (${response.status}): ${text}`, response.status);
    }

    const data: AIResponse = await response.json();
    const textBlock = data.content?.find((b) => b.type === 'text');
    if (!textBlock?.text) {
      throw new AIError('No text content in API response');
    }
    return textBlock.text;
  }
}
