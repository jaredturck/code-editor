import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openEditorWindow: vi.fn(),
  openPanel: vi.fn(),
}));

vi.mock('@/platform-context/AgentSettingsContext', () => ({
  useOrbShell: () => ({ isPillsVisible: true }),
  usePanels: () => ({ openPanel: mocks.openPanel }),
}));

vi.mock('@/platform/desktopShellWindow', () => ({
  openDesktopEditorWindow: mocks.openEditorWindow,
}));

vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    button: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      whileHover: _whileHover,
      whileTap: _whileTap,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, unknown>) => (
      <button {...props}>{children}</button>
    ),
  },
}));

import OrbPills from '@/components/orb/OrbPills';

describe('OrbPills editor launcher', () => {
  beforeEach(() => {
    mocks.openEditorWindow.mockReset();
    mocks.openPanel.mockReset();
  });

  it('replaces Train with Editor and opens the independent editor window', () => {
    render(<OrbPills orbSize={500} />);

    expect(screen.queryByRole('button', { name: 'Train' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Editor' }));

    expect(mocks.openEditorWindow).toHaveBeenCalledOnce();
    expect(mocks.openPanel).not.toHaveBeenCalledWith('editor');
  });

  it('keeps standard pills routed through the workspace panel API', () => {
    render(<OrbPills orbSize={500} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(mocks.openPanel).toHaveBeenCalledWith('chat');
  });
});
