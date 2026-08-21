/**
 * Provides the shared class-name merger used by React UI primitives and feature components.
 * It combines conditional classes and resolves conflicting Tailwind utilities into one
 * final string.
 */

import type { ClassValue } from 'clsx';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Merges conditional class names and resolves conflicting Tailwind utilities.
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export const isIframe: boolean = typeof window !== 'undefined' && window.self !== window.top;
