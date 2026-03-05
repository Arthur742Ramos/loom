import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore } from '../store/appStore';
import { ChevronDown, Check, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export const ModelPicker: React.FC<{
  value: string;
  onChange: (model: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const availableModels = useAppStore((s) => s.availableModels);
  const modelsLoading = useAppStore((s) => s.modelsLoading);
  const fetchModels = useAppStore((s) => s.fetchModels);
  const normalizedSearch = search.trim().toLowerCase();
  const current = useMemo(
    () => availableModels.find((model) => model.id === value),
    [availableModels, value],
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setSearch('');
      searchRef.current?.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!normalizedSearch) return availableModels;
    return availableModels.filter(
      (model) =>
        model.label.toLowerCase().includes(normalizedSearch)
        || model.provider.toLowerCase().includes(normalizedSearch)
        || model.id.toLowerCase().includes(normalizedSearch),
    );
  }, [availableModels, normalizedSearch]);

  const groupedProviders = useMemo(() => {
    const grouped = new Map<string, typeof filtered>();
    for (const model of filtered) {
      const existing = grouped.get(model.provider);
      if (existing) {
        existing.push(model);
      } else {
        grouped.set(model.provider, [model]);
      }
    }
    return [...grouped.entries()];
  }, [filtered]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
      >
        <span className="font-medium">{current?.label || value}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-64 bg-card border rounded-lg shadow-lg z-50 flex flex-col max-h-[380px]">
          <div className="flex items-center gap-1 p-2 border-b">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none px-1"
            />
            <button
              onClick={(e) => { e.stopPropagation(); fetchModels(); }}
              className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
              title="Refresh models from GitHub"
            >
              {modelsLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <RefreshCw className="w-3 h-3" />}
            </button>
          </div>
          <div className="overflow-y-auto py-1">
            {groupedProviders.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">No models found</p>
            )}
            {groupedProviders.map(([provider, models]) => {
              return (
                <div key={provider}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider sticky top-0 bg-card">
                    {provider}
                  </div>
                  {models.map((m) => (
                    <button
                      key={m.id}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors',
                        m.id === value
                          ? 'text-foreground bg-secondary/60'
                          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40',
                      )}
                      onClick={() => { onChange(m.id); setOpen(false); }}
                    >
                      <Check className={cn('w-3 h-3 shrink-0', m.id === value ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{m.label}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
