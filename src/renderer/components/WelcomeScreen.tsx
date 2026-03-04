import React from 'react';
import { useAppStore } from '../store/appStore';
import { FolderPlus } from 'lucide-react';
import { Button } from './ui/button';

export const WelcomeScreen: React.FC = () => {
  const projectPath = useAppStore((s) => s.projectPath);
  const setProject = useAppStore((s) => s.setProject);
  const createThread = useAppStore((s) => s.createThread);

  const handleOpenProject = async () => {
    if (typeof window !== 'undefined' && (window as any).require) {
      const { ipcRenderer } = (window as any).require('electron');
      const path = await ipcRenderer.invoke('project:select-dir');
      if (path) {
        const name = path.split(/[/\\]/).pop() || path;
        setProject(path, name);
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header matching Codex style */}
      <div className="px-8 pt-8 pb-4">
        <h1 className="text-xl font-semibold text-foreground">New thread</h1>
      </div>

      {/* Center content */}
      <div className="flex-1 flex items-center justify-center px-8">
        {!projectPath ? (
          <div className="text-center max-w-sm">
            <p className="text-muted-foreground mb-6 text-sm">
              Open a project folder to start working with Loom
            </p>
            <Button
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
          </div>
        )}
      </div>
    </div>
  );
};
