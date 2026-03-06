import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { X, Sun, Moon, Monitor, Download } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface UpdaterCheckResult {
  available: boolean;
  version?: string;
}

interface AppVersionResult {
  version?: string;
}

type IntegrationCheckStatus = 'ok' | 'warning' | 'error';

interface IntegrationCheck {
  status: IntegrationCheckStatus;
  summary: string;
  action?: string;
}

interface IntegrationDiagnostics {
  checkedAt: number;
  githubAuth: IntegrationCheck;
  copilot: IntegrationCheck;
  mcp: IntegrationCheck;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const statusBadgeClass: Record<IntegrationCheckStatus, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  error: 'border-red-500/30 bg-red-500/10 text-red-400',
};

export const SettingsPanel: React.FC = () => {
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const projectPath = useAppStore((s) => s.projectPath);
  const showToolOutputDetails = useAppStore((s) => s.showToolOutputDetails);
  const setShowToolOutputDetails = useAppStore((s) => s.setShowToolOutputDetails);
  const [updateStatus, setUpdateStatus] = useState<{ status: string; version?: string } | null>(null);
  const [appVersion, setAppVersion] = useState<string>('…');
  const [diagnosticsRunning, setDiagnosticsRunning] = useState(false);
  const [diagnostics, setDiagnostics] = useState<IntegrationDiagnostics | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    return api.on('updater:status', (data: { status: string; version?: string }) => {
      setUpdateStatus(data);
    });
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    closeButtonRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowSettings(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSettings, setShowSettings]);

  useEffect(() => {
    if (!showSettings) return;
    const api = window.electronAPI;
    if (!api) return;
    let mounted = true;
    api.invoke<AppVersionResult>('app:get-version')
      .then((result) => {
        if (!mounted) return;
        if (result?.version) setAppVersion(result.version);
      })
      .catch(() => {
        if (mounted) setAppVersion('unknown');
      });
    return () => { mounted = false; };
  }, [showSettings]);

  const runDiagnostics = async () => {
    const api = window.electronAPI;
    if (!api) {
      setDiagnostics({
        checkedAt: Date.now(),
        githubAuth: {
          status: 'error',
          summary: 'Electron bridge is unavailable.',
          action: 'Restart Loom and try running diagnostics again.',
        },
        copilot: {
          status: 'error',
          summary: 'Cannot reach main-process integration checks.',
          action: 'Restart Loom and verify Electron preload loaded correctly.',
        },
        mcp: {
          status: 'warning',
          summary: 'Skipped project MCP validation without Electron bridge.',
          action: 'Open Loom desktop app to run MCP diagnostics.',
        },
      });
      return;
    }

    setDiagnosticsRunning(true);
    const checkedAt = Date.now();

    const authResult = await api.invoke<{ authenticated: boolean; user?: { login?: string } }>('auth:get-user')
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error: getErrorMessage(error) }));

    const modelResult = await api.invoke<{ success: boolean; models?: { id: string }[]; error?: string }>('agent:list-models')
      .then((value) => ({ ok: true as const, value }))
      .catch((error: unknown) => ({ ok: false as const, error: getErrorMessage(error) }));

    const mcpResult = projectPath
      ? await api.invoke<Record<string, unknown>>('agent:list-project-mcp', projectPath)
        .then((value) => ({ ok: true as const, value }))
        .catch((error: unknown) => ({ ok: false as const, error: getErrorMessage(error) }))
      : ({ ok: true as const, value: {} as Record<string, unknown> });

    const githubAuth: IntegrationCheck = authResult.ok
      ? authResult.value.authenticated
        ? {
            status: 'ok',
            summary: `Authenticated as @${authResult.value.user?.login || 'unknown-user'}.`,
          }
        : {
            status: 'error',
            summary: 'Not authenticated with GitHub.',
            action: 'Run gh auth login, then re-run diagnostics.',
          }
      : {
          status: 'error',
          summary: `Failed to query GitHub auth status: ${authResult.error}`,
          action: 'Run gh auth login and check network connectivity.',
        };

    const copilot: IntegrationCheck = modelResult.ok
      ? modelResult.value.success && (modelResult.value.models?.length || 0) > 0
        ? {
            status: 'ok',
            summary: `${modelResult.value.models?.length || 0} model(s) available from Copilot.`,
          }
        : {
            status: 'error',
            summary: `Copilot model listing failed: ${modelResult.value.error || 'No models returned'}`,
            action: 'Confirm Copilot CLI is installed/authenticated and your subscription is active.',
          }
      : {
          status: 'error',
          summary: `Failed to query Copilot models: ${modelResult.error}`,
          action: 'Ensure copilot CLI is installed and reachable from Loom.',
        };

    let mcp: IntegrationCheck;
    if (!projectPath) {
      mcp = {
        status: 'warning',
        summary: 'No project selected, so MCP validation was skipped.',
        action: 'Open a project folder and run diagnostics again.',
      };
    } else if (!mcpResult.ok) {
      mcp = {
        status: 'error',
        summary: `Failed to read project MCP config: ${mcpResult.error}`,
        action: 'Check .vscode/mcp.json or .github/copilot/mcp.json for syntax errors.',
      };
    } else {
      const serverNames = Object.keys(mcpResult.value);
      if (serverNames.length > 0) {
        mcp = {
          status: 'ok',
          summary: `${serverNames.length} MCP server(s) configured: ${serverNames.join(', ')}`,
        };
      } else {
        mcp = {
          status: 'warning',
          summary: 'No project MCP servers configured.',
          action: 'Add .vscode/mcp.json or .github/copilot/mcp.json if you use MCP tools.',
        };
      }
    }

    setDiagnostics({ checkedAt, githubAuth, copilot, mcp });
    setDiagnosticsRunning(false);
  };

  const renderCheck = (label: string, check: IntegrationCheck, testId: string) => (
    <div className="rounded-lg border border-border bg-background/50 p-3" data-testid={testId}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
            statusBadgeClass[check.status],
          )}
        >
          {check.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{check.summary}</p>
      {check.action ? <p className="mt-1 text-[11px] text-foreground/90">{check.action}</p> : null}
    </div>
  );

  if (!showSettings) return null;

  const themes = [
    { id: 'light' as const, label: 'Light', icon: Sun },
    { id: 'dark' as const, label: 'Dark', icon: Moon },
    { id: 'system' as const, label: 'System', icon: Monitor },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="settings-panel"
      onClick={(e) => { if (e.target === e.currentTarget) setShowSettings(false); }}>
      <div
        className="bg-card rounded-2xl shadow-xl w-[480px] max-h-[80vh] overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-label="Settings panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-foreground">Settings</h2>
          <Button
            ref={closeButtonRef}
            data-testid="settings-close-button"
            aria-label="Close settings"
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
                aria-label={`Set ${label} theme`}
                aria-pressed={theme === id}
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
              aria-label="Show tool output details"
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

        {/* Integrations */}
        <div className="px-6 py-5 border-t">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-foreground">Integrations</h3>
              <p className="text-xs text-muted-foreground">
                Validate GitHub auth, Copilot model access, and project MCP configuration.
              </p>
            </div>
            <Button
              data-testid="settings-run-diagnostics"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={diagnosticsRunning}
              onClick={() => {
                runDiagnostics().catch((error: unknown) => {
                  setDiagnostics({
                    checkedAt: Date.now(),
                    githubAuth: {
                      status: 'error',
                      summary: `Diagnostics failed: ${getErrorMessage(error)}`,
                    },
                    copilot: {
                      status: 'error',
                      summary: 'Copilot diagnostics did not complete.',
                    },
                    mcp: {
                      status: 'warning',
                      summary: 'MCP diagnostics did not complete.',
                    },
                  });
                  setDiagnosticsRunning(false);
                });
              }}
            >
              {diagnosticsRunning ? 'Running…' : 'Run diagnostics'}
            </Button>
          </div>
          {diagnostics ? (
            <div className="space-y-2" data-testid="settings-diagnostics-results">
              {renderCheck('GitHub Auth', diagnostics.githubAuth, 'settings-diagnostics-github')}
              {renderCheck('Copilot Models', diagnostics.copilot, 'settings-diagnostics-copilot')}
              {renderCheck('Project MCP', diagnostics.mcp, 'settings-diagnostics-mcp')}
              <p className="text-[11px] text-muted-foreground">
                Last checked at {new Date(diagnostics.checkedAt).toLocaleTimeString()}.
              </p>
            </div>
          ) : null}
        </div>

        {/* Version & Updates */}
        <div className="px-6 py-4 border-t">
          <div className="flex items-center justify-between" aria-live="polite">
            <p className="text-[11px] text-muted-foreground">Loom v{appVersion} · Powered by GitHub Copilot</p>
            {updateStatus?.status === 'downloaded' ? (
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => window.electronAPI?.send('updater:install')}
              >
                <Download className="w-3 h-3" />
                Install v{updateStatus.version}
              </Button>
            ) : updateStatus?.status === 'available' ? (
              <span className="text-[11px] text-primary">Downloading v{updateStatus.version}…</span>
            ) : (
              <button
                aria-label="Check for updates"
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                onClick={async () => {
                  const api = window.electronAPI;
                  if (!api) return;
                  try {
                    const result = await api.invoke<UpdaterCheckResult>('updater:check');
                    if (result.available) {
                      setUpdateStatus({ status: 'available', version: result.version });
                    } else {
                      setUpdateStatus({ status: 'up-to-date' });
                    }
                  } catch {
                    setUpdateStatus({ status: 'error' });
                  }
                }}
              >
                {updateStatus?.status === 'up-to-date'
                  ? '✓ Up to date'
                  : updateStatus?.status === 'error'
                    ? 'Update check failed'
                    : 'Check for updates'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
