/**
 * Converts the current conversation into copyable Markdown or downloadable JSON while
 * preserving speaker, tool, artifact, and timing information. Browser download and
 * clipboard details stay here so export controls share one representation.
 */

import type { ChatMessage, UnknownRecord } from '../types';

// Copies text to clipboard without mutating the source value.
export async function copyTextToClipboard(text: unknown): Promise<boolean> {
  const value = String(text || '');
  if (!value) return false;

  if (typeof navigator !== 'undefined' && navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to legacy copy path.
    }
  }

  if (typeof document === 'undefined') return false;

  try {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

// Handles the text file chat command without starting a normal agent request.
export function downloadTextFile(
  fileName: unknown,
  text: unknown,
  mimeType = 'text/plain;charset=utf-8',
): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;

  try {
    const blob = new Blob([String(text || '')], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = String(fileName || 'export.txt');
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}

// Formats chat markdown for stable display or serialization without changing its underlying
// meaning.
export function formatChatMarkdown(messages: ChatMessage[], meta: UnknownRecord = {}): string {
  const lines: string[] = [];
  lines.push(`# ${meta.title || 'IRIS chat'}`, '');
  const tag = [meta.provider, meta.model].filter(Boolean).join(' · ');
  if (tag) lines.push(`*${tag}*`, '');
  lines.push(`*Exported ${new Date().toLocaleString()}*`, '', '---', '');

  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?._injected) continue;
    const who =
      message.role === 'user'
        ? 'You'
        : message.role === 'assistant'
          ? 'IRIS'
          : message.role || 'note';
    const content =
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    lines.push(`### ${who}`, '', content, '');
  }

  return lines.join('\n');
}

// Formats chat JSON for stable display or serialization without changing its underlying meaning.
export function formatChatJson(messages: ChatMessage[], meta: UnknownRecord = {}): string {
  return JSON.stringify(
    {
      title: meta.title || 'IRIS chat',
      provider: meta.provider || '',
      model: meta.model || '',
      exportedAt: new Date().toISOString(),
      messages: (Array.isArray(messages) ? messages : [])
        .filter((message) => !message?._injected)
        .map((message) => ({
          role: message.role,
          content:
            typeof message.content === 'string' ? message.content : JSON.stringify(message.content),
        })),
    },
    null,
    2,
  );
}
