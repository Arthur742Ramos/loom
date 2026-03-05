import React, { useEffect, useRef, useState } from 'react';
import { ThreadTokenUsage } from '../store/appStore';
import { cn } from '../lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const compactTokenFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const tokenFormatter = new Intl.NumberFormat('en-US');

export const formatCompactTokens = (tokens: number): string => compactTokenFormatter.format(tokens);

const formatTokens = (tokens: number): string => tokenFormatter.format(tokens);

interface TokenCounterProps {
  usage: ThreadTokenUsage;
  className?: string;
}

export const TokenCounter: React.FC<TokenCounterProps> = ({ usage, className }) => {
  const computedTotal = usage.totalTokens || (
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  );
  const [isUpdated, setIsUpdated] = useState(false);
  const previousTotalRef = useRef(computedTotal);

  useEffect(() => {
    if (computedTotal === previousTotalRef.current) return;
    previousTotalRef.current = computedTotal;
    setIsUpdated(true);
    const timeout = window.setTimeout(() => setIsUpdated(false), 220);
    return () => window.clearTimeout(timeout);
  }, [computedTotal]);

  if (computedTotal <= 0) return null;

  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="token-counter"
          className={cn(
            'inline-flex items-center rounded-full border border-border/80 bg-muted/45 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground',
            className,
          )}
        >
          <span className={cn('token-counter-value', isUpdated && 'token-counter-value-updated')}>
            {formatCompactTokens(computedTotal)} tokens
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        data-testid="token-counter-tooltip"
        side="bottom"
        align="end"
        className="token-counter-tooltip w-[220px] border border-border/90 bg-card/95 px-3 py-2 text-[11px] text-muted-foreground shadow-xl"
      >
        <div className="space-y-1">
          <div className="token-counter-tooltip-row">
            <span>Prompt</span>
            <span>{formatTokens(usage.inputTokens)}</span>
          </div>
          <div className="token-counter-tooltip-row">
            <span>Completion</span>
            <span>{formatTokens(usage.outputTokens)}</span>
          </div>
          {usage.cacheReadTokens > 0 && (
            <div className="token-counter-tooltip-row">
              <span>Cache read</span>
              <span>{formatTokens(usage.cacheReadTokens)}</span>
            </div>
          )}
          {usage.cacheWriteTokens > 0 && (
            <div className="token-counter-tooltip-row">
              <span>Cache write</span>
              <span>{formatTokens(usage.cacheWriteTokens)}</span>
            </div>
          )}
          <div className="mt-1 border-t border-border/80 pt-1 token-counter-tooltip-row text-foreground">
            <span>Total</span>
            <span>{formatTokens(computedTotal)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
