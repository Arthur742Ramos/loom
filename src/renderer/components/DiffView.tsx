import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Button } from './ui/button';
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { DiffFile, DiffHunk, DiffLine } from '../../shared/types';

const diffStatusMeta: Record<DiffFile['status'], { label: string; badgeClass: string }> = {
  added: {
    label: 'Added',
    badgeClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  modified: {
    label: 'Modified',
    badgeClass: 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  deleted: {
    label: 'Deleted',
    badgeClass: 'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
  },
  renamed: {
    label: 'Renamed',
    badgeClass: 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
};

const lineBackgroundClass: Record<DiffLine['type'], string> = {
  add: 'bg-emerald-500/10',
  del: 'bg-rose-500/10',
  ctx: '',
};

const lineNumberClass: Record<DiffLine['type'], string> = {
  add: 'text-emerald-600/70 border-emerald-500/20 bg-emerald-500/10 dark:text-emerald-400/80',
  del: 'text-rose-600/70 border-rose-500/20 bg-rose-500/10 dark:text-rose-400/80',
  ctx: 'text-muted-foreground/40 border-border/30',
};

const lineMarkerClass: Record<DiffLine['type'], string> = {
  add: 'text-emerald-600 dark:text-emerald-400',
  del: 'text-rose-600 dark:text-rose-400',
  ctx: 'text-transparent',
};

const lineContentClass: Record<DiffLine['type'], string> = {
  add: 'text-emerald-700 dark:text-emerald-300',
  del: 'text-rose-700 dark:text-rose-300',
  ctx: 'text-foreground',
};

const loadingRows = [0, 1, 2];

const buildExpandedFiles = (
  previousExpanded: Set<string>,
  previousFiles: DiffFile[],
  nextFiles: DiffFile[],
): Set<string> => {
  if (nextFiles.length === 0) return new Set();
  if (previousFiles.length === 0) return new Set(nextFiles.map((file) => file.path));

  const previousPaths = new Set(previousFiles.map((file) => file.path));
  return new Set(
    nextFiles
      .filter((file) => !previousPaths.has(file.path) || previousExpanded.has(file.path))
      .map((file) => file.path),
  );
};

const DiffLoadingSkeleton: React.FC<{ staged: boolean }> = ({ staged }) => (
  <div className="space-y-3 p-4" aria-live="polite" role="status" data-testid="diff-loading">
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Loading {staged ? 'staged' : 'unstaged'} changes…
    </p>
    {loadingRows.map((row) => (
      <div key={row} className="overflow-hidden rounded-lg border border-border/60 bg-card/50">
        <div className="flex items-center gap-3 border-b border-border/40 px-4 py-3">
          <span className="inline-flex h-4 w-4 rounded bg-secondary/80" />
          <span className="inline-flex h-3 w-20 rounded bg-secondary/70" />
          <span className="ml-auto inline-flex h-3 w-14 rounded bg-secondary/60" />
        </div>
        <div className="space-y-2 px-4 py-3">
          <div className="h-3 rounded bg-secondary/50" />
          <div className="h-3 w-5/6 rounded bg-secondary/50" />
          <div className="h-3 w-2/3 rounded bg-secondary/40" />
        </div>
      </div>
    ))}
  </div>
);

const DiffLineRow = React.memo(({ line }: { line: DiffLine }) => (
  <div className={cn('flex min-w-max', lineBackgroundClass[line.type])}>
    <span
      className={cn(
        'w-[56px] shrink-0 border-r pr-2 text-right text-[11px] tabular-nums select-none',
        lineNumberClass[line.type],
      )}
    >
      {line.oldLine ?? ''}
    </span>
    <span
      className={cn(
        'w-[56px] shrink-0 border-r pr-2 text-right text-[11px] tabular-nums select-none',
        lineNumberClass[line.type],
      )}
    >
      {line.newLine ?? ''}
    </span>
    <span className={cn('w-5 shrink-0 text-center text-[11px] select-none', lineMarkerClass[line.type])}>
      {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
    </span>
    <span className={cn('flex-1 px-2 whitespace-pre select-text', lineContentClass[line.type])}>
      {line.content}
    </span>
  </div>
));

DiffLineRow.displayName = 'DiffLineRow';

const DiffHunkSection = React.memo(({ hunk }: { hunk: DiffHunk }) => (
  <div className="border-t border-border/40">
    <div className="px-4 py-1.5 bg-primary/5 font-mono text-[11px] text-primary tabular-nums">
      @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
      {hunk.header ? <span className="ml-2 text-muted-foreground">{hunk.header}</span> : null}
    </div>
    <div className="overflow-x-auto">
      <div className="min-w-max font-mono text-[12px] leading-[1.6]">
        {hunk.lines.map((line, index) => (
          <DiffLineRow
            key={`${line.type}-${line.oldLine ?? 'new'}-${line.newLine ?? 'old'}-${index}`}
            line={line}
          />
        ))}
      </div>
    </div>
  </div>
));

DiffHunkSection.displayName = 'DiffHunkSection';

interface DiffFileSectionProps {
  file: DiffFile;
  expanded: boolean;
  onToggle: (path: string) => void;
}

const DiffFileSection = React.memo(({ file, expanded, onToggle }: DiffFileSectionProps) => {
  const status = diffStatusMeta[file.status];

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        className="group flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-secondary/40"
        onClick={() => onToggle(file.path)}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} diff for ${file.path}`}
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
            !expanded && '-rotate-90',
          )}
        />
        <span
          className={cn(
            'inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            status.badgeClass,
          )}
        >
          {status.label}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-foreground" title={file.path}>
          {file.path}
        </span>
        {file.oldPath ? (
          <span className="hidden max-w-[30%] truncate text-[11px] text-muted-foreground md:inline" title={file.oldPath}>
            ← {file.oldPath}
          </span>
        ) : null}
        <span className="shrink-0 text-[11px] tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{file.additions}</span>{' '}
          <span className="text-rose-600 dark:text-rose-400">-{file.deletions}</span>
        </span>
      </button>
      {expanded ? file.hunks.map((hunk, index) => (
        <DiffHunkSection key={`${file.path}-hunk-${index}`} hunk={hunk} />
      )) : null}
    </div>
  );
});

DiffFileSection.displayName = 'DiffFileSection';

export const DiffView: React.FC<{ projectPath: string }> = ({ projectPath }) => {
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [staged, setStaged] = useState(false);
  const filesRef = useRef<DiffFile[]>([]);
  const requestIdRef = useRef(0);

  const loadDiff = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const api = window.electronAPI;
      if (!api) {
        if (requestId === requestIdRef.current) {
          filesRef.current = [];
          setFiles([]);
          setExpandedFiles(new Set());
        }
        return;
      }

      const result = await api.invoke<{ files?: DiffFile[] }>('git:diff', projectPath, staged);
      if (requestId !== requestIdRef.current) return;

      const parsed = Array.isArray(result.files) ? result.files : [];
      const previousFiles = filesRef.current;
      filesRef.current = parsed;
      setFiles(parsed);
      setExpandedFiles((previousExpanded) => buildExpandedFiles(previousExpanded, previousFiles, parsed));
    } catch (error: unknown) {
      if (requestId !== requestIdRef.current) return;
      console.error('Failed to load diff:', error);
      filesRef.current = [];
      setFiles([]);
      setExpandedFiles(new Set());
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [projectPath, staged]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

  const toggleFile = useCallback((path: string) => {
    setExpandedFiles((previousExpanded) => {
      const nextExpanded = new Set(previousExpanded);
      if (nextExpanded.has(path)) {
        nextExpanded.delete(path);
      } else {
        nextExpanded.add(path);
      }
      return nextExpanded;
    });
  }, []);

  const diffTotals = useMemo(
    () => files.reduce((acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }), { additions: 0, deletions: 0 }),
    [files],
  );

  const hasFiles = files.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="diff-view" aria-busy={loading}>
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-4 py-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={() => { void loadDiff(); }}
          disabled={loading}
          aria-label="Refresh diff"
          data-testid="diff-refresh-button"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
        <div className="flex items-center gap-0.5 rounded-md bg-secondary/50 p-0.5">
          <button
            type="button"
            aria-pressed={!staged}
            onClick={() => setStaged(false)}
            className={cn(
              'rounded px-2 py-0.5 text-[10px] font-medium transition-all',
              !staged ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Unstaged
          </button>
          <button
            type="button"
            aria-pressed={staged}
            onClick={() => setStaged(true)}
            className={cn(
              'rounded px-2 py-0.5 text-[10px] font-medium transition-all',
              staged ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            Staged
          </button>
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {loading
            ? `Refreshing ${staged ? 'staged' : 'unstaged'} changes…`
            : hasFiles
              ? (
                <>
                  {files.length} file{files.length !== 1 ? 's' : ''} ·{' '}
                  <span className="tabular-nums text-emerald-600 dark:text-emerald-400">+{diffTotals.additions}</span>{' '}
                  <span className="tabular-nums text-rose-600 dark:text-rose-400">-{diffTotals.deletions}</span>
                </>
              )
              : `No ${staged ? 'staged' : 'unstaged'} changes`}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="diff-scroll-container">
        {loading && !hasFiles ? <DiffLoadingSkeleton staged={staged} /> : null}
        {!loading && !hasFiles ? (
          <div
            className="flex min-h-[220px] flex-col items-center justify-center gap-1.5 text-sm text-muted-foreground/70"
            data-testid="diff-empty-state"
          >
            <p className="font-medium text-foreground/90">You're all caught up</p>
            <p>No {staged ? 'staged' : 'unstaged'} changes</p>
            <p className="text-xs text-muted-foreground/60">Edit files to see live diffs here.</p>
          </div>
        ) : null}
        {hasFiles ? files.map((file) => (
          <DiffFileSection
            key={file.path}
            file={file}
            expanded={expandedFiles.has(file.path)}
            onToggle={toggleFile}
          />
        )) : null}
      </div>
    </div>
  );
};
