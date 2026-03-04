import React from 'react';
import { useAppStore } from '../store/appStore';
import { Minus, Square, X } from 'lucide-react';
import { Button } from './ui/button';
import { LoomIcon } from './LoomIcon';

export const TitleBar: React.FC = () => {
  const projectName = useAppStore((s) => s.projectName);

  const ipc = (channel: string) => {
    if (typeof window !== 'undefined' && (window as any).require) {
      const { ipcRenderer } = (window as any).require('electron');
      ipcRenderer.send(channel);
    }
  };

  return (
    <div className="drag-region h-[42px] bg-card border-b flex items-center justify-between px-3 shrink-0 rounded-t-2xl">
      <div className="flex items-center gap-4 flex-1">
        <div className="flex items-center gap-2 text-primary font-semibold text-[13px]">
          <LoomIcon className="w-[18px] h-[18px]" />
          <span className="tracking-wide">Loom</span>
        </div>
        {projectName && (
          <span className="text-muted-foreground text-xs px-2 py-0.5 bg-muted rounded-md">
            {projectName}
          </span>
        )}
      </div>
      <div className="no-drag flex gap-0.5">
        <Button variant="ghost" size="icon" className="w-9 h-7 text-muted-foreground" onClick={() => ipc('window:minimize')}>
          <Minus className="w-3 h-3" />
        </Button>
        <Button variant="ghost" size="icon" className="w-9 h-7 text-muted-foreground" onClick={() => ipc('window:maximize')}>
          <Square className="w-3 h-3" />
        </Button>
        <Button variant="ghost" size="icon" className="w-9 h-7 text-muted-foreground hover:bg-red-600 hover:text-white" onClick={() => ipc('window:close')}>
          <X className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
};
