import React, { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ThreadPanel } from './components/ThreadPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
import { TooltipProvider } from './components/ui/tooltip';
import { SettingsPanel } from './components/SettingsPanel';
import { useAppStore } from './store/appStore';

const App: React.FC = () => {
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const projectPath = useAppStore((s) => s.projectPath);
  const theme = useAppStore((s) => s.theme);
  const createThread = useAppStore((s) => s.createThread);
  const setShowSettings = useAppStore((s) => s.setShowSettings);

  useEffect(() => {
    const apply = (resolved: 'light' | 'dark') => {
      document.documentElement.setAttribute('data-theme', resolved);
    };

    if (theme !== 'system') {
      apply(theme);
      return;
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    apply(mq.matches ? 'dark' : 'light');
    const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'n') {
        e.preventDefault();
        createThread('New thread', 'local');
      } else if (mod && e.key === ',') {
        e.preventDefault();
        setShowSettings(true);
      } else if (mod && e.key === 'l') {
        e.preventDefault();
        // Focus chat input
        const input = document.querySelector('textarea[data-loom-chat-input]') as HTMLTextAreaElement | null;
        input?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [createThread, setShowSettings]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen bg-background" data-testid="app-root">
        {/* Drag region for frameless window */}
        <div className="drag-region fixed top-0 left-0 right-0 h-8 z-50" />

        {/* Sidebar */}
        <Sidebar />

        {/* Main content — white rounded card */}
        <main className="flex-1 flex p-3 pl-0 min-w-0">
          <div className="flex-1 flex flex-col bg-card rounded-2xl shadow-sm overflow-hidden min-h-0">
            {!projectPath ? (
              <WelcomeScreen />
            ) : activeThreadId ? (
              <ThreadPanel />
            ) : (
              <WelcomeScreen />
            )}
          </div>
        </main>
      </div>
      <SettingsPanel />
    </TooltipProvider>
  );
};

export default App;
