/**
 * Verifies that desktop-control approval is short-lived, bound to one exact plan, and
 * consumed after one attempt. These properties prevent a renderer or direct bridge caller
 * from replaying approval for later or modified mouse and keyboard actions.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAutomationApprovalsForTests,
  consumeAutomationApproval,
  createAutomationApproval,
} from '../../server/desktopBridge/shared/automationApproval';

afterEach(() => clearAutomationApprovalsForTests());

describe('automation approval capabilities', () => {
  it('can be consumed only once for the exact approved action plan', () => {
    const request = {
      cwd: '/tmp/iris',
      actions: [{ type: 'click', x: 120, y: 240 }],
    };
    const token = createAutomationApproval(request);

    expect(consumeAutomationApproval(token, request)).toBe(true);
    expect(consumeAutomationApproval(token, request)).toBe(false);
  });

  it('invalidates a token when the action plan or working directory is changed', () => {
    const request = {
      cwd: '/tmp/iris',
      actions: [{ type: 'type', text: 'safe text' }],
    };
    const token = createAutomationApproval(request);

    expect(
      consumeAutomationApproval(token, {
        ...request,
        actions: [{ type: 'type', text: 'different text' }],
      }),
    ).toBe(false);
    expect(consumeAutomationApproval(token, request)).toBe(false);
  });
});
