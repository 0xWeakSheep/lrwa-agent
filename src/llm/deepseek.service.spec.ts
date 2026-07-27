import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import {
  DeepSeekService,
  type DeepSeekJsonRequest,
  type FetchLike,
} from './deepseek.service';

const responseSchema = z
  .object({
    content: z.string(),
    suggestions: z.array(z.string()),
  })
  .strict();

type TestValue = z.infer<typeof responseSchema>;

const request: DeepSeekJsonRequest<TestValue> = {
  operation: 'PLAN',
  systemPrompt: 'Return JSON.',
  userPrompt: 'Draft a bounded evidence plan.',
  schema: responseSchema,
  fallback: {
    content: 'deterministic',
    suggestions: ['fallback'],
  },
};

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function successResponse(value: TestValue): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(value),
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

describe('DeepSeekService', () => {
  it('uses an immediate deterministic fallback when no API key exists', async () => {
    const fetcher = jest.fn<Promise<Response>, Parameters<FetchLike>>();
    const service = new DeepSeekService(config({}), fetcher);

    const result = await service.generateJson(request);

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.value).toEqual(request.fallback);
    expect(result.provenance).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      mode: 'DETERMINISTIC_FALLBACK',
      operation: 'PLAN',
      attempts: 0,
      reason: 'NO_API_KEY',
    });
  });

  it('calls the configured OpenAI-compatible endpoint and returns JSON', async () => {
    let capturedInput: string | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetcher = jest.fn<Promise<Response>, Parameters<FetchLike>>(
      (input: string | URL, init?: RequestInit) => {
        capturedInput = input;
        capturedInit = init;
        return Promise.resolve(
          successResponse({ content: 'live', suggestions: ['verified'] }),
        );
      },
    );
    const service = new DeepSeekService(
      config({
        DEEPSEEK_API_KEY: 'test-secret-never-exposed',
        DEEPSEEK_BASE_URL: 'https://deepseek.example/',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
        ENABLE_LIVE_LLM: 'true',
      }),
      fetcher,
    );

    const result = await service.generateJson(request);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(capturedInput).toBe('https://deepseek.example/chat/completions');
    expect(capturedInit?.headers).toMatchObject({
      authorization: 'Bearer test-secret-never-exposed',
    });
    expect(typeof capturedInit?.body).toBe('string');
    expect(JSON.parse(capturedInit?.body as string)).toMatchObject({
      model: 'deepseek-v4-flash',
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      max_tokens: 512,
    });
    expect(JSON.stringify(result.provenance)).not.toContain(
      'test-secret-never-exposed',
    );
    expect(result).toEqual({
      value: { content: 'live', suggestions: ['verified'] },
      provenance: {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        mode: 'LIVE',
        operation: 'PLAN',
        attempts: 1,
      },
    });
  });

  it('keeps live model calls disabled unless the process explicitly enables them', async () => {
    const fetcher = jest.fn<Promise<Response>, Parameters<FetchLike>>();
    const service = new DeepSeekService(
      config({ DEEPSEEK_API_KEY: 'configured-but-disabled' }),
      fetcher,
    );

    const result = await service.generateJson(request);

    expect(fetcher).not.toHaveBeenCalled();
    expect(result.provenance).toMatchObject({
      mode: 'DETERMINISTIC_FALLBACK',
      attempts: 0,
      reason: 'LIVE_DISABLED',
    });
  });

  it('caps live requests per process before making another paid call', async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<FetchLike>>()
      .mockResolvedValue(successResponse({ content: 'live', suggestions: [] }));
    const service = new DeepSeekService(
      config({
        DEEPSEEK_API_KEY: 'test-key',
        ENABLE_LIVE_LLM: 'true',
        MAX_LIVE_LLM_HTTP_REQUESTS_PER_PROCESS: '1',
      }),
      fetcher,
    );

    await service.generateJson(request);
    const capped = await service.generateJson(request);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(capped.provenance).toMatchObject({
      mode: 'DETERMINISTIC_FALLBACK',
      attempts: 0,
      reason: 'BUDGET_EXHAUSTED',
    });
  });

  it('retries 429 once and then succeeds', async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<FetchLike>>()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(
        successResponse({ content: 'retry worked', suggestions: [] }),
      );
    const service = new DeepSeekService(
      config({
        DEEPSEEK_API_KEY: 'test-key',
        ENABLE_LIVE_LLM: 'true',
      }),
      fetcher,
    );

    const result = await service.generateJson(request);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.provenance).toMatchObject({
      mode: 'LIVE',
      attempts: 2,
    });
  });

  it('falls back without leaking upstream failures', async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<FetchLike>>()
      .mockResolvedValue(new Response('', { status: 503 }));
    const service = new DeepSeekService(
      config({
        DEEPSEEK_API_KEY: 'test-key',
        ENABLE_LIVE_LLM: 'true',
      }),
      fetcher,
    );

    const result = await service.generateJson(request);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.value).toEqual(request.fallback);
    expect(result.provenance).toMatchObject({
      mode: 'DETERMINISTIC_FALLBACK',
      attempts: 2,
      reason: 'UPSTREAM_ERROR',
    });
  });

  it('classifies a non-JSON success body as an invalid response', async () => {
    const fetcher = jest
      .fn<Promise<Response>, Parameters<FetchLike>>()
      .mockResolvedValue(new Response('not-json', { status: 200 }));
    const service = new DeepSeekService(
      config({
        DEEPSEEK_API_KEY: 'test-key',
        ENABLE_LIVE_LLM: 'true',
      }),
      fetcher,
    );

    const result = await service.generateJson(request);

    expect(result.provenance).toMatchObject({
      mode: 'DETERMINISTIC_FALLBACK',
      attempts: 1,
      reason: 'INVALID_RESPONSE',
    });
  });
});
