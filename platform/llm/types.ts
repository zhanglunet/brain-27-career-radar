/** 可替换的大模型接口。实现方不得记录消息内容或模型输出。 */

export type ChatMessage = { role: "system" | "user"; content: string };

export type LlmResult = { json: unknown; usage: { promptTokens: number; completionTokens: number } };

export interface LlmProvider {
  completeJson(messages: ChatMessage[]): Promise<LlmResult>;
}

/** unavailable：网络 / 超时 / 5xx；bad_response：输出不是 JSON；too_long：输出达到长度上限被截断。 */
export type LlmErrorKind = "unavailable" | "bad_response" | "too_long";

export class LlmError extends Error {
  kind: LlmErrorKind;
  /** 可写进日志的简短错误细节（HTTP 状态码、超时、格式问题），不含任何请求或响应内容。 */
  detail: string;

  constructor(kind: LlmErrorKind, message: string, detail = "") {
    super(message);
    this.kind = kind;
    this.detail = detail;
  }
}
