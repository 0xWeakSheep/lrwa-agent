import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { LlmOperation, LlmProvenance } from '../domain/types';

export const DEEPSEEK_FETCH = 'DEEPSEEK_FETCH';

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface DeepSeekJsonRequest<T> {
  operation: LlmOperation;
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  fallback: T;
}

export interface DeepSeekJsonResult<T> {
  value: T;
  provenance: LlmProvenance;
}

const apiResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string(),
        }),
      }),
    )
    .min(1),
});

const timeoutMs = 4_500;
const maxAttempts = 2;

function stripJsonFence(content: string): string {
  const trimmed = content.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function fallbackResult<T>(
  fallback: T,
  model: string,
  operation: LlmOperation,
  attempts: number,
  reason: NonNullable<LlmProvenance['reason']>,
): DeepSeekJsonResult<T> {
  return {
    value: fallback,
    provenance: {
      provider: 'deepseek',
      model,
      mode: 'DETERMINISTIC_FALLBACK',
      operation,
      attempts,
      reason,
    },
  };
}

@Injectable()
export class DeepSeekService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(DEEPSEEK_FETCH) private readonly fetcher: FetchLike,
  ) {}

  async generateJson<T>(
    request: DeepSeekJsonRequest<T>,
  ): Promise<DeepSeekJsonResult<T>> {
    const model =
      this.configService.get<string>('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash';
    const apiKey = this.configService.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey) {
      return fallbackResult(
        request.fallback,
        model,
        request.operation,
        0,
        'NO_API_KEY',
      );
    }
    const baseUrl =
      this.configService.get<string>('DEEPSEEK_BASE_URL') ??
      'https://api.deepseek.com';
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let lastReason: NonNullable<LlmProvenance['reason']> = 'UPSTREAM_ERROR';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), timeoutMs);
      try {
        const response = await this.fetcher(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.userPrompt },
            ],
            response_format: { type: 'json_object' },
            thinking: { type: 'disabled' },
            max_tokens: 512,
            temperature: 0.1,
            stream: false,
          }),
          signal: abortController.signal,
        });
        if (!response.ok) {
          lastReason =
            response.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM_ERROR';
          if (
            attempt < maxAttempts &&
            (response.status === 429 || response.status >= 500)
          ) {
            await this.retryDelay(attempt);
            continue;
          }
          return fallbackResult(
            request.fallback,
            model,
            request.operation,
            attempt,
            lastReason,
          );
        }

        const envelope = apiResponseSchema.safeParse(await response.json());
        if (!envelope.success) {
          return fallbackResult(
            request.fallback,
            model,
            request.operation,
            attempt,
            'INVALID_RESPONSE',
          );
        }
        let parsedContent: unknown;
        try {
          parsedContent = JSON.parse(
            stripJsonFence(envelope.data.choices[0].message.content),
          ) as unknown;
        } catch {
          return fallbackResult(
            request.fallback,
            model,
            request.operation,
            attempt,
            'INVALID_RESPONSE',
          );
        }
        const parsed = request.schema.safeParse(parsedContent);
        if (!parsed.success) {
          return fallbackResult(
            request.fallback,
            model,
            request.operation,
            attempt,
            'INVALID_RESPONSE',
          );
        }
        return {
          value: parsed.data,
          provenance: {
            provider: 'deepseek',
            model,
            mode: 'LIVE',
            operation: request.operation,
            attempts: attempt,
          },
        };
      } catch (error: unknown) {
        lastReason =
          error instanceof Error && error.name === 'AbortError'
            ? 'TIMEOUT'
            : 'NETWORK_ERROR';
        if (attempt < maxAttempts) {
          await this.retryDelay(attempt);
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    return fallbackResult(
      request.fallback,
      model,
      request.operation,
      maxAttempts,
      lastReason,
    );
  }

  private async retryDelay(attempt: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, attempt * 120);
    });
  }
}
