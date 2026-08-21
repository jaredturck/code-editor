/** Verifies that saved and streamed search answers use IRIS's safe Markdown renderer. */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SearchAnswerCard from '@/components/search/SearchAnswerCard';

describe('SearchAnswerCard', () => {
  it('renders GFM emphasis and descriptive links instead of showing Markdown punctuation', () => {
    render(
      <SearchAnswerCard
        title="Local answer"
        content="A cat is **Felis catus**. Read [Wikipedia](https://en.wikipedia.org/wiki/Cat)."
      />,
    );

    expect(screen.getByText('Felis catus').tagName).toBe('STRONG');
    expect(screen.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Cat',
    );
  });

  it('shows the cursor separately while streamed Markdown is growing', () => {
    const { container } = render(
      <SearchAnswerCard title="Detailed answer" content="Generating **now" streaming detailed />,
    );
    expect(container.querySelector('.orbit-search-stream-cursor')).not.toBeNull();
  });
});
