import React from 'react';
import { cn } from '../lib/utils';

interface LoomIconProps {
  className?: string;
  strokeWidth?: number;
}

/**
 * Loom brand icon — a stylised loom/thread spool.
 * Three vertical warp threads crossed by a curved weft thread.
 */
export const LoomIcon: React.FC<LoomIconProps> = ({ className, strokeWidth = 1.5 }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cn('shrink-0', className)}
  >
    {/* Loom frame */}
    <rect x="3" y="3" width="18" height="18" rx="3" strokeWidth={strokeWidth} />
    {/* Warp threads (vertical) */}
    <line x1="8" y1="6" x2="8" y2="18" />
    <line x1="12" y1="6" x2="12" y2="18" />
    <line x1="16" y1="6" x2="16" y2="18" />
    {/* Weft threads (horizontal weave) */}
    <path d="M6 10 C7 9, 9 11, 10 10 S13 9, 14 10 S17 11, 18 10" />
    <path d="M6 14 C7 15, 9 13, 10 14 S13 15, 14 14 S17 13, 18 14" />
  </svg>
);

/**
 * Compact loom logo mark — for sidebar brand and small contexts.
 */
export const LoomLogo: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn(
    'rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center',
    className
  )}>
    <LoomIcon className="text-white" strokeWidth={1.8} />
  </div>
);
