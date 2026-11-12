/** DeepSeek Chat Completions（OpenAI 兼容）实现。 */
import { LlmError } from "./types.ts";
import type { ChatMessage, LlmProvider, LlmResult } from "./types.ts";

type DeepSeekOptions = {
  apiKey: string;
  fetch: typeof fetch;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export function createDeepSeekProvider(opts: DeepSeekOptions): LlmProvider {
  const model = opts.model ?? "deepseek-chat";
  const baseUrl = opts.baseUrl ?? "https://api.deepseek.com";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return {
    async completeJson(messages: ChatMessage[]): Promise<LlmResult> {
      let response: Response;
      try {
        response = await opts.fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, response_format: { type: "json_object" }, temperature: 0, max_tokens: 8192 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new LlmError("unavailable", "DeepSeek 请求失败");
      }
      if (!response.ok) throw new LlmError("unavailable", `DeepSeek 返回 ${response.status}`);
      let body: { choices?: { finish_reason?: string; message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      try {
        body = await response.json();
      } catch {
        throw new LlmError("bad_response", "DeepSeek 响应不是 JSON");
      }
      if (body.choices?.[0]?.finish_reason === "length") throw new LlmError("too_long", "DeepSeek 输出达到长度上限");
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new LlmError("bad_response", "DeepSeek 响应缺少内容");
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        throw new LlmError("bad_response", "DeepSeek 输出不是 JSON");
      }
      return {
        json,
        usage: { promptTokens: body.usage?.prompt_tokens ?? 0, completionTokens: body.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
