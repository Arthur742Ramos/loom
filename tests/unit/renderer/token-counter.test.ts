import { describe, it, expect } from 'vitest';
import { formatCompactTokens } from '../../../src/renderer/components/TokenCounter';

describe('formatCompactTokens', () => {
  it('formats small numbers directly', () => {
    expect(formatCompactTokens(500)).toBe('500');
  });

  it('formats thousands with K', () => {
    const result = formatCompactTokens(1500);
    expect(result).toMatch(/1\.5K/i);
  });

  it('formats millions with M', () => {
    const result = formatCompactTokens(2500000);
    expect(result).toMatch(/2\.5M/i);
  });

  it('handles zero', () => {
    expect(formatCompactTokens(0)).toBe('0');
  });
});
