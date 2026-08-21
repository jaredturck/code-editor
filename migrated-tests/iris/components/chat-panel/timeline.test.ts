import { describe, expect, it } from 'vitest';
import {
  getEventBody,
  getEventLabel,
  getEventOneLine,
} from '@/components/chat-panel/utils/timeline';

describe('Agent Activity timeline presentation', () => {
  it('shows paid cloud requests with provider, model, and budget position', () => {
    const event = {
      id: 1,
      at: 1,
      type: 'cloud_request',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      reason: 'Resolve a difficult architecture conflict',
      requestNumber: 2,
      requestLimit: 3,
    };

    expect(getEventLabel(event)).toBe('Cloud request · deepseek');
    expect(getEventOneLine(event)).toContain('deepseek-v4-flash');
    expect(getEventOneLine(event)).toContain('request 2/3');
    expect(getEventBody(event)).toBe('Resolve a difficult architecture conflict');
  });

  it('turns common file and retrieval tools into useful activity labels', () => {
    expect(
      getEventLabel({
        id: 1,
        at: 1,
        type: 'tool_call',
        tool: 'files.read',
        args: { path: '/tmp/project/sessionRunner.ts' },
      }),
    ).toBe('Read sessionRunner.ts');

    expect(
      getEventLabel({
        id: 2,
        at: 1,
        type: 'tool_call',
        tool: 'rag.retrieve',
      }),
    ).toBe('Search local index');
  });
});
