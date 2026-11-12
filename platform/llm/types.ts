/** 可替换的大模型接口。实现方不得记录消息内容或模型输出。 */

export type ChatMessage = { role: "system" | "user"; content: string };

export type LlmResult = { json: unknown; usage: { promptTokens: number; completionTokens: number } };

export interface LlmProvider {
  completeJson(messages: ChatMessage[]): Promise<LlmResult>;
}

export class LlmError extends Error {
  kind: "unavailable" | "bad_response";

  constructor(kind: "unavailable" | "bad_response", message: string) {
    super(message);
    this.kind = kind;
  }
}
