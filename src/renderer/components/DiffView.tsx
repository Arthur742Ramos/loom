import React, { useState, useEffect, useMemo } from 'react';
import { Button } from './ui/button';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { DiffFile, DiffHunk, DiffLine } from '../../shared/types';

export const DiffView: React.FC<{ projectPath: string }> = ({ projectPath }) => {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [staged, setStaged] = useState(false);

  const loadDiff = async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (api) {
        const result = await api.invoke<{ files?: DiffFile[] }>('git:diff', projectPath, staged);
        const parsed = Array.isArray(result.files) ? result.files : [];
        setFiles(parsed);
        setExpandedFiles(new Set(parsed.map((f) => f.path)));
      }
    } catch (err: unknown) {
      console.error('Failed to load diff:', err);
      setFiles([]);
    }
    setLoading(false);
  };

  useEffect(() => { loadDiff(); }, [projectPath, staged]);

  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const statusIcon = (s: DiffFile['status']) =>
    s === 'added' ? '🟢' : s === 'deleted' ? '🔴' : s === 'renamed' ? '🔵' : '🟡';
  const diffTotals = useMemo(
    () => files.reduce((acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }), { additions: 0, deletions: 0 }),
    [files],
  );

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" data-testid="diff-view" aria-busy={loading}>
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-card shrink-0">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={loadDiff}
          disabled={loading}
        >
          <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} /> Refresh
        </Button>
        <div className="flex items-center gap-0.5 bg-secondary/50 rounded-md p-0.5">
          <button
            aria-pressed={!staged}
            onClick={() => setStaged(false)}
            className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-all',
              !staged ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >Unstaged</button>
          <button
            aria-pressed={staged}
            onClick={() => setStaged(true)}
            className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-all',
              staged ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >Staged</button>
        </div>
        {files.length > 0 && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            {files.length} file{files.length !== 1 ? 's' : ''} ·{' '}
            <span className="text-green-600">+{diffTotals.additions}</span>{' '}
            <span className="text-red-500">-{diffTotals.deletions}</span>
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && (
          <div className="p-4 space-y-2" aria-live="polite" role="status">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-7 rounded-md bg-secondary/60 animate-pulse" />
            ))}
          </div>
        )}
        {!loading && files.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[220px] text-muted-foreground/70 text-sm gap-1.5">
            <p className="font-medium text-foreground/90">You're all caught up</p>
            <p>No {staged ? 'staged' : 'unstaged'} changes</p>
            <p className="text-xs text-muted-foreground/60">Edit files to see live diffs here.</p>
          </div>
        )}
        {files.map((file) => (
          <div key={file.path} className="border-b last:border-b-0">
            <button
              className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-secondary/40 transition-colors"
              onClick={() => toggleFile(file.path)}
              aria-expanded={expandedFiles.has(file.path)}
            >
              <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform',
                !expandedFiles.has(file.path) && '-rotate-90')} />
              <span className="text-xs">{statusIcon(file.status)}</span>
              <span className="text-[13px] font-mono text-foreground truncate flex-1">{file.path}</span>
              {file.oldPath && (
                <span className="text-[11px] text-muted-foreground">← {file.oldPath}</span>
              )}
              <span className="text-[11px] shrink-0">
                <span className="text-green-600">+{file.additions}</span>
                {' '}
                <span className="text-red-500">-{file.deletions}</span>
              </span>
            </button>
            {expandedFiles.has(file.path) && file.hunks.map((hunk: DiffHunk, hi: number) => (
              <div key={hi} className="border-t border-border/40">
                <div className="px-4 py-1 bg-primary/5 text-[11px] font-mono text-primary">
                  @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                  {hunk.header && <span className="text-muted-foreground ml-2">{hunk.header}</span>}
                </div>
                <div className="font-mono text-[12px] leading-[1.6]">
                  {hunk.lines.map((line: DiffLine, li: number) => (
                    <div key={li} className={cn('flex',
                      line.type === 'add' && 'bg-green-500/10',
                      line.type === 'del' && 'bg-red-500/10',
                    )}>
                      <span className={cn('w-[52px] shrink-0 text-right pr-2 select-none text-[11px] border-r',
                        line.type === 'add' ? 'text-green-500/60 border-green-500/20 bg-green-500/10' :
                        line.type === 'del' ? 'text-red-500/60 border-red-500/20 bg-red-500/10' :
                        'text-muted-foreground/40 border-border/30',
                      )}>
                        {line.oldLine ?? ''}
                      </span>
                      <span className={cn('w-[52px] shrink-0 text-right pr-2 select-none text-[11px] border-r',
                        line.type === 'add' ? 'text-green-500/60 border-green-500/20 bg-green-500/10' :
                        line.type === 'del' ? 'text-red-500/60 border-red-500/20 bg-red-500/10' :
                        'text-muted-foreground/40 border-border/30',
                      )}>
                        {line.newLine ?? ''}
                      </span>
                      <span className={cn('w-5 shrink-0 text-center select-none text-[11px]',
                        line.type === 'add' ? 'text-green-600' :
                        line.type === 'del' ? 'text-red-500' : 'text-transparent',
                      )}>
                        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                      </span>
                      <span className={cn('flex-1 px-2 whitespace-pre select-text',
                        line.type === 'add' ? 'text-green-700 dark:text-green-400' :
                        line.type === 'del' ? 'text-red-700 dark:text-red-400' : 'text-foreground',
                      )}>
                        {line.content}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
