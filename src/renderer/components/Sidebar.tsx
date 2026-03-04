import React, { useState } from 'react';
import { useAppStore } from '../store/appStore';
import { Button } from './ui/button';
import { ScrollArea } from './ui/scroll-area';
import { Separator } from './ui/separator';
import {
  SquarePen, Clock, LayoutGrid, Folder, FolderPlus, ListFilter, FolderPlusIcon,
  Clipboard, Trash2, GitBranch, Monitor, LogIn, LogOut, RefreshCw,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { LoomLogo } from './LoomIcon';

export const Sidebar: React.FC = () => {
  const threads = useAppStore((s) => s.threads);
  const projects = useAppStore((s) => s.projects);
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const setActiveThread = useAppStore((s) => s.setActiveThread);
  const createThread = useAppStore((s) => s.createThread);
  const removeThread = useAppStore((s) => s.removeThread);
  const projectPath = useAppStore((s) => s.projectPath);
  const projectName = useAppStore((s) => s.projectName);
  const setProject = useAppStore((s) => s.setProject);
  const githubUser = useAppStore((s) => s.githubUser);
  const setGitHubUser = useAppStore((s) => s.setGitHubUser);
  const fetchModels = useAppStore((s) => s.fetchModels);
  const [loginLoading, setLoginLoading] = useState(false);

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

  const handleNewThread = (path?: string, name?: string) => {
    const targetPath = path || projectPath;
    const targetName = name || projectName;
    if (!targetPath || !targetName) return;
    if (targetPath !== projectPath) {
      setProject(targetPath, targetName);
    }
    createThread('New thread', 'local');
  };

  const ipcRenderer = typeof window !== 'undefined' && (window as any).require
    ? (window as any).require('electron').ipcRenderer
    : null;

  const checkAuthStatus = async () => {
    if (!ipcRenderer) return;
    setLoginLoading(true);
    try {
      const result = await ipcRenderer.invoke('auth:get-user');
      if (result.authenticated) {
        setGitHubUser(result.user);
        fetchModels(); // refresh models after auth
      } else {
        setGitHubUser(null);
      }
    } catch {
      setGitHubUser(null);
    }
    setLoginLoading(false);
  };

  const handleLogin = async () => {
    if (!ipcRenderer) return;
    setLoginLoading(true);
    const result = await ipcRenderer.invoke('auth:login');
    if (!result.success) {
      setLoginLoading(false);
    }
    // After login window opens, user needs to click "Check status"
    setLoginLoading(false);
  };

  const handleLogout = async () => {
    if (!ipcRenderer) return;
    await ipcRenderer.invoke('auth:logout');
    setGitHubUser(null);
  };

  // Check auth on mount
  React.useEffect(() => { checkAuthStatus(); }, []);

  const statusDot: Record<string, string> = {
    idle: 'bg-gray-300',
    running: 'bg-primary animate-pulse',
    completed: 'bg-green-500',
    error: 'bg-red-500',
  };

  return (
    <aside className="w-[280px] flex flex-col pt-10 pb-4 shrink-0">
      {/* Brand */}
      <div className="px-5 mb-6 flex items-center gap-2.5">
        <LoomLogo className="w-7 h-7 p-1" />
        <span className="text-[15px] font-semibold text-foreground">Loom</span>
      </div>

      {/* Clipboard icon */}
      <div className="px-5 mb-4">
        <button className="text-muted-foreground hover:text-foreground transition-colors">
          <Clipboard className="w-5 h-5" strokeWidth={1.5} />
        </button>
      </div>

      {/* Nav items */}
      <nav className="px-3 space-y-0.5 mb-6">
        <button
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors"
          onClick={() => handleNewThread()}
        >
          <SquarePen className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
          New thread
        </button>
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors">
          <Clock className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
          Automations
        </button>
        <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors">
          <LayoutGrid className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
          Skills
        </button>
      </nav>

      {/* Threads section */}
      <div className="px-5 flex items-center justify-between mb-2">
        <span className="text-[13px] text-muted-foreground">Threads</span>
        <div className="flex gap-1">
          <button className="text-muted-foreground hover:text-foreground transition-colors p-1" onClick={() => handleNewThread()}>
            <FolderPlus className="w-4 h-4" strokeWidth={1.5} />
          </button>
          <button className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <ListFilter className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Projects & threads */}
      <ScrollArea className="flex-1 px-3">
        {projects.map((project) => {
          const projectThreads = threads.filter((thread) =>
            (thread.projectPath || projectPath) === project.path,
          );
          const isActiveProject = projectPath === project.path;
          return (
            <div className="mb-3" key={project.path}>
              {/* Project folder */}
              <div
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer rounded-lg transition-colors',
                  isActiveProject
                    ? 'text-foreground bg-secondary/50'
                    : 'text-foreground hover:bg-secondary/60',
                )}
                onClick={() => setProject(project.path, project.name)}
                onDoubleClick={() => handleNewThread(project.path, project.name)}
              >
                <Folder className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
                {project.name}
              </div>

              {/* Thread list under project */}
              {projectThreads.length === 0 ? (
                <p className="pl-10 text-[13px] text-muted-foreground/60 py-1">No threads</p>
              ) : (
                <div className="ml-4 space-y-0.5">
                  {projectThreads.map((thread) => (
                    <div
                      key={thread.id}
                      className={cn(
                        'group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors relative',
                        activeThreadId === thread.id
                          ? 'bg-secondary text-foreground'
                          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                      )}
                      onClick={() => setActiveThread(thread.id)}
                    >
                      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDot[thread.status] || statusDot.idle)} />
                      <span className="truncate flex-1">{thread.title}</span>
                      <button
                        className="hidden group-hover:block text-muted-foreground hover:text-destructive transition-colors"
                        onClick={(e) => { e.stopPropagation(); removeThread(thread.id); }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Add project */}
        <button
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors"
          onClick={handleOpenProject}
        >
          <FolderPlusIcon className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
          Add project
        </button>
      </ScrollArea>
      {/* Account */}
      <div className="px-3 pt-2 mt-auto border-t">
        {githubUser ? (
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <img
              src={githubUser.avatar_url}
              alt={githubUser.login}
              className="w-6 h-6 rounded-full shrink-0"
            />
            <span className="text-sm text-foreground truncate flex-1">
              {githubUser.name || githubUser.login}
            </span>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              onClick={handleLogout}
              title="Sign out"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors"
              onClick={handleLogin}
              disabled={loginLoading}
            >
              <LogIn className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
              {loginLoading ? 'Opening login...' : 'Sign in with GitHub'}
            </button>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:bg-secondary transition-colors"
              onClick={checkAuthStatus}
              disabled={loginLoading}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loginLoading && 'animate-spin')} strokeWidth={1.5} />
              Check login status
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
