import { toPreview } from '@/platform/agent/agentJsonUtils';

const STRUCTURED_TRANSCRIPT_MAX_MESSAGES = 12;
const STRUCTURED_TOOL_RESULT_CHAR_CAP = 6000;

export function buildStructuredRuntimeObservation({
  userInput,
  toolName,
  args,
  ok,
  content,
  todos = [],
}) {
  const todoLines = Array.isArray(todos)
    ? todos
        .slice(0, 8)
        .map(
          (todo) =>
            `- [${String(todo?.status || 'pending')}] ${String(todo?.text || '').slice(0, 140)}`,
        )
        .join('\n')
    : '';
  const outcome = ok ? 'succeeded' : 'failed';
  const nextInstruction = ok
    ? 'Use this result as evidence and choose the next action that best advances the original objective.'
    : 'This action failed. Reassess the original objective, the exact failure, and the evidence gathered so far. Decide the next action yourself. Do not repeat the same unchanged action unless you have a concrete reason the outcome may now differ.';

  return [
    '# Runtime observation',
    `Original objective: ${String(userInput || '').trim().slice(0, 2000)}`,
    `Action: ${String(toolName || 'unknown')}`,
    `Arguments: ${toPreview(args || {}, 1200)}`,
    `Outcome: ${outcome}`,
    `Result:\n${String(content || '(no output)').slice(0, STRUCTURED_TOOL_RESULT_CHAR_CAP)}`,
    ...(todoLines ? [`Current todos:\n${todoLines}`] : []),
    nextInstruction,
  ].join('\n\n');
}

export function appendStructuredRuntimeTurn(transcript, assistantText, observation) {
  if (!Array.isArray(transcript)) return [];
  transcript.push({ role: 'assistant', content: String(assistantText || '') });
  transcript.push({ role: 'user', content: String(observation || '') });
  if (transcript.length > STRUCTURED_TRANSCRIPT_MAX_MESSAGES) {
    transcript.splice(0, transcript.length - STRUCTURED_TRANSCRIPT_MAX_MESSAGES);
  }
  return transcript;
}

export function structuredToolResultCap() {
  return STRUCTURED_TOOL_RESULT_CHAR_CAP;
}
