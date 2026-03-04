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
  const updateThread = useAppStore((s) => s.updateThread);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const projectPath = useAppStore((s) => s.projectPath);
  const projectName = useAppStore((s) => s.projectName);
  const setProject = useAppStore((s) => s.setProject);
  const githubUser = useAppStore((s) => s.githubUser);
  const setGitHubUser = useAppStore((s) => s.setGitHubUser);
  const fetchModels = useAppStore((s) => s.fetchModels);
  const [loginLoading, setLoginLoading] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [skills, setSkills] = useState<{ name: string; path: string; description: string }[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);

  const loadSkills = async () => {
    if (!projectPath || typeof window === 'undefined' || !(window as any).require) return;
    setSkillsLoading(true);
    try {
      const { ipcRenderer } = (window as any).require('electron');
      const result = await ipcRenderer.invoke('agent:list-skills', projectPath);
      setSkills(result || []);
    } catch { setSkills([]); }
    setSkillsLoading(false);
  };

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
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors',
            showSkills && 'bg-secondary',
          )}
          onClick={() => { setShowSkills(!showSkills); if (!showSkills) loadSkills(); }}
        >
          <LayoutGrid className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
          Skills
        </button>
        {showSkills && (
          <div className="ml-6 mr-2 mb-1 mt-0.5 space-y-1">
            {skillsLoading && <p className="text-[11px] text-muted-foreground/60 py-1">Loading...</p>}
            {!skillsLoading && skills.length === 0 && (
              <div className="text-[11px] text-muted-foreground/60 py-1 space-y-1">
                <p>No skills found.</p>
                <p className="text-[10px]">Add <code className="bg-secondary px-1 rounded">.md</code> files to <code className="bg-secondary px-1 rounded">.github/copilot/skills/</code></p>
              </div>
            )}
            {skills.map((skill) => (
              <div key={skill.name} className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-secondary/40 text-[11px]">
                <LayoutGrid className="w-3 h-3 text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium text-foreground truncate">{skill.name}</p>
                  {skill.description && <p className="text-muted-foreground truncate">{skill.description}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
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
                      {editingThreadId === thread.id ? (
                        <input
                          className="flex-1 bg-transparent text-sm outline-none border-b border-primary px-0 py-0 min-w-0"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onBlur={() => {
                            if (editingTitle.trim()) updateThread(thread.id, { title: editingTitle.trim() });
                            setEditingThreadId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); }
                            if (e.key === 'Escape') { setEditingThreadId(null); }
                          }}
                          onClick={(e) => e.stopPropagation()}
                          autoFocus
                        />
                      ) : (
                        <span
                          className="truncate flex-1"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingThreadId(thread.id);
                            setEditingTitle(thread.title);
                          }}
                        >{thread.title}</span>
                      )}
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
