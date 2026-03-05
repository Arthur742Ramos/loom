import React from 'react';
import { useAppStore } from '../store/appStore';
import { X, Sun, Moon, Monitor } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

export const SettingsPanel: React.FC = () => {
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const showToolOutputDetails = useAppStore((s) => s.showToolOutputDetails);
  const setShowToolOutputDetails = useAppStore((s) => s.setShowToolOutputDetails);

  if (!showSettings) return null;

  const themes = [
    { id: 'light' as const, label: 'Light', icon: Sun },
    { id: 'dark' as const, label: 'Dark', icon: Moon },
    { id: 'system' as const, label: 'System', icon: Monitor },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="settings-panel"
      onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
      <div className="bg-card rounded-2xl shadow-xl w-[480px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-foreground">Settings</h2>
          <Button
            data-testid="settings-close-button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowSettings(false)}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Theme */}
        <div className="px-6 py-5">
          <h3 className="text-sm font-medium text-foreground mb-3">Appearance</h3>
          <div className="grid grid-cols-3 gap-2">
            {themes.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTheme(id)}
                className={cn(
                  'flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all',
                  theme === id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40',
                )}
              >
                <Icon className={cn('w-5 h-5', theme === id ? 'text-primary' : 'text-muted-foreground')} />
                <span className={cn('text-xs font-medium', theme === id ? 'text-primary' : 'text-muted-foreground')}>
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Chat */}
        <div className="px-6 py-5 border-t">
          <h3 className="text-sm font-medium text-foreground mb-3">Chat</h3>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              data-testid="settings-tool-output-toggle"
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={showToolOutputDetails}
              onChange={(e) => setShowToolOutputDetails(e.target.checked)}
            />
            <div>
              <p className="text-sm text-foreground">Show tool output details</p>
              <p className="text-xs text-muted-foreground">
                When off, tool names and status stay visible while verbose tool output is hidden.
              </p>
            </div>
          </label>
        </div>

        {/* Version */}
        <div className="px-6 py-4 border-t">
          <p className="text-[11px] text-muted-foreground">Loom v0.1.0 · Powered by GitHub Copilot</p>
        </div>
      </div>
    </div>
  );
};
