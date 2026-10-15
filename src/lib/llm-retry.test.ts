import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isRetryableHttpStatus,
  isRetryableLlmError,
  retryDelayMs,
  withLlmRetry,
} from './llm-retry';

describe('llm-retry', () => {
  it('classifies retryable statuses and errors', () => {
    assert.equal(isRetryableHttpStatus(429), true);
    assert.equal(isRetryableHttpStatus(503), true);
    assert.equal(isRetryableHttpStatus(401), false);
    assert.equal(isRetryableLlmError(new Error('网络请求失败，请检查')), true);
    assert.equal(isRetryableLlmError(new Error('请求被限流（429）')), true);
    assert.equal(isRetryableLlmError(new Error('模型服务繁忙（503）')), true);
    assert.equal(
      isRetryableLlmError(new Error('{"code":"service_unavailable_error","message":"too busy"}')),
      true,
    );
    assert.equal(isRetryableLlmError(new Error('API Key 无效或已过期（401）')), false);
  });

  it('retryDelayMs grows with attempt', () => {
    assert.ok(retryDelayMs(1, 100) >= retryDelayMs(0, 100));
  });

  it('withLlmRetry retries then succeeds', async () => {
    let n = 0;
    const v = await withLlmRetry(
      async () => {
        n += 1;
        if (n < 3) throw new Error('请求被限流（429），请稍后重试');
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 1 },
    );
    assert.equal(v, 'ok');
    assert.equal(n, 3);
  });

  it('withLlmRetry does not retry non-retryable', async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withLlmRetry(
          async () => {
            n += 1;
            throw new Error('API Key 无效或已过期（401），请检查模型设置');
          },
          { maxAttempts: 3, baseDelayMs: 1 },
        ),
      /401/,
    );
    assert.equal(n, 1);
  });
});
