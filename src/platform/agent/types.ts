/**
 * Provides the types definitions or transformations shared by the agent runtime, provider
 * schemas, and UI. It helps keep model-facing behavior consistent across native-tool and
 * controller execution modes.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  estimated?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ProviderGenerationTimings {
  totalMs?: number;
  loadMs?: number;
  promptEvalMs?: number;
  generationMs?: number;
  firstResponseMs?: number;
  firstThinkingMs?: number;
  firstAnswerMs?: number;
  thinkingStreamMs?: number;
  answerStreamMs?: number;
}

export interface ProviderMeta {
  provider: string;
  model: string;
  text: string;
  usage: Usage | null;
  toolCalls: ToolCall[];
  stopReason: string;
  thinkingText: string;
  timings?: ProviderGenerationTimings;
}

export interface ModelCapabilities {
  family: string;
  provider: string;
  toolProtocol: 'native' | 'json';
  streaming: boolean;
  structuredOutput: 'json_schema' | 'response_schema' | 'tools' | 'grammar' | 'none';
  reasoning: boolean;
  maxOutputTokens: number;
  maxOutputCeiling?: number;
  contextWindow: number;
  caching: 'explicit' | 'auto' | 'implicit' | 'passthrough' | 'none';
}

export interface JsonSchemaTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type ControllerAction =
  | {
      type: 'tool';
      tool: string;
      args: Record<string, unknown>;
      message?: never;
    }
  | { type: 'final'; message: string; tool?: never; args?: never };

export interface ControllerDecision {
  thinking: string;
  todoUpdates: Array<Record<string, unknown>>;
  action: ControllerAction;
}

export interface AIMessageContentPart {
  type?: string;
  text?: string;
  image_url?: { url?: string } | string;
  inline_data?: { mime_type?: string; data?: string };
  [key: string]: unknown;
}
