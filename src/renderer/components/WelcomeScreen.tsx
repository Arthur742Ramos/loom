import React from 'react';
import { useAppStore } from '../store/appStore';
import { FolderPlus, Sparkles } from 'lucide-react';
import { Button } from './ui/button';

export const WelcomeScreen: React.FC = () => {
  const projectPath = useAppStore((s) => s.projectPath);
  const setProject = useAppStore((s) => s.setProject);

  const handleOpenProject = async () => {
    const api = window.electronAPI;
    if (!api) return;
    try {
      const selectedPath = await api.invoke<string | null>('project:select-dir');
      if (typeof selectedPath === 'string' && selectedPath.length > 0) {
        const name = selectedPath.split(/[/\\]/).pop() || selectedPath;
        setProject(selectedPath, name);
      }
    } catch {
      // Dialog cancelled or IPC error
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full" data-testid="welcome-screen">
      {/* Header matching Codex style */}
      <div className="px-8 pt-8 pb-4">
        <h1 className="text-xl font-semibold text-foreground">New thread</h1>
      </div>

      {/* Center content */}
      <div className="flex-1 flex items-center justify-center px-8">
        {!projectPath ? (
          <div className="text-center max-w-sm">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-secondary/30 px-3 py-1 text-[11px] text-muted-foreground mb-4">
              <Sparkles className="w-3 h-3" />
              Ready when you are
            </div>
            <p className="text-muted-foreground mb-6 text-sm">
              Open a project folder to start weaving coding threads.
            </p>
            <Button
              data-testid="welcome-add-project-button"
              variant="outline"
              className="gap-2 h-10 px-5 text-sm"
              onClick={handleOpenProject}
            >
              <FolderPlus className="w-4 h-4" />
              Add project
            </Button>
          </div>
        ) : (
          <div className="text-center max-w-sm">
            <p className="text-muted-foreground text-sm">
              Click "New thread" in the sidebar to start a task
            </p>
            <p className="text-[11px] text-muted-foreground/70 mt-2">Tip: press Ctrl/Cmd + N to create one instantly.</p>
          </div>
        )}
      </div>
    </div>
  );
};
