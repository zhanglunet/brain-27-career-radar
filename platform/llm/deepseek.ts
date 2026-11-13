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

/** API key 只能是可见 ASCII；复制时混进的零宽空格、全角字符会让 Workers 构造请求头时直接抛 TypeError。 */
export function cleanApiKey(raw: string): string | null {
  const key = raw.trim();
  return /^[\x21-\x7e]+$/.test(key) ? key : null;
}

export function createDeepSeekProvider(opts: DeepSeekOptions): LlmProvider {
  const model = opts.model ?? "deepseek-chat";
  const baseUrl = opts.baseUrl ?? "https://api.deepseek.com";
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return {
    async completeJson(messages: ChatMessage[]): Promise<LlmResult> {
      const apiKey = cleanApiKey(opts.apiKey);
      if (!apiKey) throw new LlmError("unavailable", "DeepSeek key 含有非法字符", "key_invalid_chars");
      let response: Response;
      // 先取出函数再直接调用：Workers 里以 opts.fetch(...) 形式调用全局 fetch 会抛 Illegal invocation。
      const fetchFn = opts.fetch;
      try {
        response = await fetchFn(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, response_format: { type: "json_object" }, temperature: 0, max_tokens: 8192 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "error";
        throw new LlmError("unavailable", "DeepSeek 请求失败", name === "TimeoutError" || name === "AbortError" ? "timeout" : `network_${name}`);
      }
      if (!response.ok) throw new LlmError("unavailable", `DeepSeek 返回 ${response.status}`, `http_${response.status}`);
      let body: { choices?: { finish_reason?: string; message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      try {
        body = await response.json();
      } catch {
        throw new LlmError("bad_response", "DeepSeek 响应不是 JSON", "body_not_json");
      }
      if (body.choices?.[0]?.finish_reason === "length") throw new LlmError("too_long", "DeepSeek 输出达到长度上限", "finish_length");
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new LlmError("bad_response", "DeepSeek 响应缺少内容", "no_content");
      let json: unknown;
      try {
        json = JSON.parse(content);
      } catch {
        throw new LlmError("bad_response", "DeepSeek 输出不是 JSON", "content_not_json");
      }
      return {
        json,
        usage: { promptTokens: body.usage?.prompt_tokens ?? 0, completionTokens: body.usage?.completion_tokens ?? 0 },
      };
    },
  };
}
