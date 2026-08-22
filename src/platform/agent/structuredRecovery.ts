import { toPreview } from '@/platform/agent/agentJsonUtils';

const STRUCTURED_TRANSCRIPT_MAX_MESSAGES = 12;
const STRUCTURED_TOOL_RESULT_CHAR_CAP = 6000;

function cleanRecoveryLine(value, maxChars = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

export function buildControllerRecoveryContext({ userInput, stepHistory = [] }) {
  const recentSteps = Array.isArray(stepHistory) ? stepHistory.slice(-8) : [];
  const latestStep = recentSteps[recentSteps.length - 1] || null;
  if (!latestStep || latestStep.ok !== false) return null;

  return {
    status: 'action_failed',
    original_goal: String(userInput || ''),
    failed_action: {
      tool: String(latestStep.tool || latestStep.requestedTool || ''),
      error: String(latestStep.error || 'Tool execution failed.'),
    },
    recent_evidence: recentSteps.slice(-6).map((item) => ({
      tool: String(item.tool || item.requestedTool || ''),
      ok: item.ok !== false,
      result:
        item.ok === false ? String(item.error || '') : String(item.summary || ''),
    })),
    instruction:
      'Reason about why the previous action failed using the exact error, original goal, and evidence gathered so far. Decide the next action yourself. Do not blindly repeat the same action unless you have a concrete reason the result may now differ.',
  };
}

export function formatRecoveryEvidence(stepHistory, limit = 12) {
  const history = Array.isArray(stepHistory) ? stepHistory : [];
  if (!history.length) return '- No tool actions were recorded.';

  return history
    .slice(-limit)
    .map((step, index) => {
      const tool = String(step.tool || step.requestedTool || 'unknown');
      const outcome =
        step.ok === false
          ? `FAILED: ${cleanRecoveryLine(step.error || step.summary || 'unknown error')}`
          : `OK: ${cleanRecoveryLine(step.summary || 'completed')}`;
      return `${index + 1}. ${tool} — ${outcome}`;
    })
    .join('\n');
}

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
