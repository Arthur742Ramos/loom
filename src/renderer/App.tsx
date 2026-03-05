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
