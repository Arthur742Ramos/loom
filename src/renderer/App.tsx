import React from 'react';
import { Sidebar } from './components/Sidebar';
import { ThreadPanel } from './components/ThreadPanel';
import { WelcomeScreen } from './components/WelcomeScreen';
import { TooltipProvider } from './components/ui/tooltip';
import { useAppStore } from './store/appStore';

const App: React.FC = () => {
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const projectPath = useAppStore((s) => s.projectPath);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen bg-background">
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
    </TooltipProvider>
  );
};

export default App;
