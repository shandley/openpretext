/**
 * Tests for src/ai/AIClient.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AIClient, AIAuthError, AIRateLimitError, AIError } from '../../src/ai/AIClient';

describe('AIClient', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset fetch mock before each test
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(status: number, body: any) {
    (globalThis.fetch as any).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  it('sends correct request format', async () => {
    mockFetch(200, {
      content: [{ type: 'text', text: 'Analysis result' }],
    });

    const client = new AIClient('test-key-123');
    await client.analyze('base64data', 'system prompt', 'user message');

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, options] = (globalThis.fetch as any).mock.calls[0];

    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(options.method).toBe('POST');
    expect(options.headers['x-api-key']).toBe('test-key-123');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');
    expect(options.headers['anthropic-dangerous-direct-browser-access']).toBe('true');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('claude-sonnet-4-5-20250929');
    expect(body.max_tokens).toBe(4096);
    expect(body.system).toBe('system prompt');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[0].content).toHaveLength(2);
    expect(body.messages[0].content[0].type).toBe('image');
    expect(body.messages[0].content[0].source.type).toBe('base64');
    expect(body.messages[0].content[0].source.data).toBe('base64data');
    expect(body.messages[0].content[1].type).toBe('text');
    expect(body.messages[0].content[1].text).toBe('user message');
  });

  it('returns text content from successful response', async () => {
    mockFetch(200, {
      content: [{ type: 'text', text: 'Here are my suggestions...' }],
    });

    const client = new AIClient('key');
    const result = await client.analyze('img', 'sys', 'usr');
    expect(result).toBe('Here are my suggestions...');
  });

  it('throws AIAuthError on 401', async () => {
    mockFetch(401, { error: { message: 'unauthorized' } });

    const client = new AIClient('bad-key');
    await expect(client.analyze('img', 'sys', 'usr')).rejects.toThrow(AIAuthError);
  });

  it('throws AIRateLimitError on 429', async () => {
    mockFetch(429, { error: { message: 'rate limited' } });

    const client = new AIClient('key');
    await expect(client.analyze('img', 'sys', 'usr')).rejects.toThrow(AIRateLimitError);
  });

  it('throws AIError on other HTTP errors', async () => {
    mockFetch(500, { error: { message: 'server error' } });

    const client = new AIClient('key');
    await expect(client.analyze('img', 'sys', 'usr')).rejects.toThrow(AIError);
  });

  it('throws AIError on network failure', async () => {
    (globalThis.fetch as any).mockRejectedValue(new TypeError('Failed to fetch'));

    const client = new AIClient('key');
    await expect(client.analyze('img', 'sys', 'usr')).rejects.toThrow(AIError);
    await expect(client.analyze('img', 'sys', 'usr')).rejects.toThrow(/Network error/);
  });

  it('throws AIError when response has no text content', async () => {
    mockFetch(200, { content: [] });

    const client = new AIClient('key');
    await expect(client.analyze('img', 'sys', 'usr')).rejects.toThrow(AIError);
    await expect(client.analyze('img', 'sys', 'usr')).rejects.toThrow(/No text content/);
  });
});
