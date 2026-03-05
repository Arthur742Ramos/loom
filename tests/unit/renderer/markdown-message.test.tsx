import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownMessage } from '../../../src/renderer/components/MarkdownMessage';

describe('MarkdownMessage', () => {
  it('renders plain text', () => {
    render(<MarkdownMessage content="Hello world" />);
    expect(screen.getByText('Hello world')).toBeInTheDocument();
  });

  it('renders code blocks with language', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const { container } = render(<MarkdownMessage content={md} />);
    const codeEl = container.querySelector('code.language-typescript');
    expect(codeEl).toBeInTheDocument();
    expect(codeEl!.textContent).toContain('const x = 1;');
  });

  it('renders inline code', () => {
    render(<MarkdownMessage content="Use `Array.map()` here" />);
    const codeEl = screen.getByText('Array.map()');
    expect(codeEl.tagName).toBe('CODE');
  });

  it('renders GFM tables', () => {
    const md = [
      '| Name | Age |',
      '| ---- | --- |',
      '| Alice | 30 |',
      '| Bob | 25 |',
    ].join('\n');
    const { container } = render(<MarkdownMessage content={md} />);
    const table = container.querySelector('table');
    expect(table).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});
