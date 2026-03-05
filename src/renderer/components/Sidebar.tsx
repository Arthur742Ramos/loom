import React, { useState } from 'react';
import { useAppStore, McpServerConfig } from '../store/appStore';
import { Button } from './ui/button';
import {Separator } from './ui/separator';
import {
  SquarePen, LayoutGrid, Folder, FolderPlus, ListFilter, FolderPlusIcon,
  Trash2, GitBranch, Monitor, LogIn, LogOut, RefreshCw, Settings,
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
  const mcpServers = useAppStore((s) => s.mcpServers);
  const addMcpServer = useAppStore((s) => s.addMcpServer);
  const removeMcpServer = useAppStore((s) => s.removeMcpServer);
  const [showMcp, setShowMcp] = useState(false);
  const [mcpForm, setMcpForm] = useState({ name: '', command: '', args: '' });
  const [projectMcp, setProjectMcp] = useState<Record<string, any>>({});
  const showSettings = useAppStore((s) => s.showSettings);
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const [showSkills, setShowSkills] = useState(false);
  const [skills, setSkills] = useState<{ name: string; path: string; description: string }[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [agents, setAgents] = useState<{ name: string; path: string; description: string }[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);

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

  const loadAgents = async () => {
    if (!projectPath || typeof window === 'undefined' || !(window as any).require) return;
    setAgentsLoading(true);
    try {
      const { ipcRenderer } = (window as any).require('electron');
      const result = await ipcRenderer.invoke('agent:list-agents', projectPath);
      setAgents(result || []);
    } catch { setAgents([]); }
    setAgentsLoading(false);
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
    <aside className="w-[280px] flex flex-col pt-10 pb-4 shrink-0" data-testid="sidebar">
      {/* Brand */}
      <div className="px-5 mb-6 flex items-center gap-2.5 shrink-0">
        <LoomLogo className="w-7 h-7 p-1" />
        <span className="text-[15px] font-semibold text-foreground">Loom</span>
      </div>

      {/* Scrollable body: nav + skills + threads */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Nav items */}
      <nav className="px-3 space-y-0.5 mb-6">
        <button
          data-testid="new-thread-button"
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors"
          onClick={() => handleNewThread()}
        >
          <SquarePen className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
          New thread
        </button>
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors',
            showMcp && 'bg-secondary',
          )}
          onClick={() => {
            setShowMcp(!showMcp);
            if (!showMcp && projectPath) {
              const { ipcRenderer } = (window as any).require('electron');
              ipcRenderer.invoke('agent:list-project-mcp', projectPath).then((r: any) => setProjectMcp(r || {}));
            }
          }}
        >
          <Monitor className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
          MCP Servers
        </button>
        {showMcp && (
          <div className="ml-4 mr-2 mb-1 mt-0.5 space-y-1.5">
            {/* Project-discovered MCP servers */}
            {Object.keys(projectMcp).length > 0 && (
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider pt-1">From project</p>
            )}
            {Object.entries(projectMcp).map(([name, config]: [string, any]) => (
              <div key={`proj-${name}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/40 text-[11px]">
                <span className="text-blue-400">●</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{name}</p>
                  <p className="text-muted-foreground truncate font-mono text-[10px]">{config.command} {config.args?.join(' ') || ''}</p>
                </div>
              </div>
            ))}
            {/* User-configured MCP servers */}
            {Object.keys(mcpServers).length > 0 && (
              <p className="text-[10px] text-muted-foreground/50 uppercase tracking-wider pt-1">Custom</p>
            )}
            {Object.entries(mcpServers).map(([name, config]) => (
              <div key={name} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-secondary/40 text-[11px]">
                <span className="text-green-500">●</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{name}</p>
                  <p className="text-muted-foreground truncate font-mono text-[10px]">{config.command} {config.args?.join(' ') || ''}</p>
                </div>
                <button
                  className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  onClick={(e) => { e.stopPropagation(); removeMcpServer(name); }}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
            {/* Add server form */}
            <div className="space-y-1 pt-1 border-t border-border/40">
              <input
                className="w-full px-2 py-1 text-[11px] bg-secondary/60 border rounded text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
                placeholder="Server name"
                value={mcpForm.name}
                onChange={(e) => setMcpForm(f => ({ ...f, name: e.target.value }))}
              />
              <input
                className="w-full px-2 py-1 text-[11px] bg-secondary/60 border rounded text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary font-mono"
                placeholder="Command (e.g. npx -y @mcp/server)"
                value={mcpForm.command}
                onChange={(e) => setMcpForm(f => ({ ...f, command: e.target.value }))}
              />
              <input
                className="w-full px-2 py-1 text-[11px] bg-secondary/60 border rounded text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary font-mono"
                placeholder="Args (space-separated, optional)"
                value={mcpForm.args}
                onChange={(e) => setMcpForm(f => ({ ...f, args: e.target.value }))}
              />
              <button
                className="w-full px-2 py-1.5 text-[11px] font-medium bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                disabled={!mcpForm.name.trim() || !mcpForm.command.trim()}
                onClick={() => {
                  addMcpServer(mcpForm.name.trim(), {
                    command: mcpForm.command.trim(),
                    args: mcpForm.args.trim() ? mcpForm.args.trim().split(/\s+/) : [],
                    tools: ['*'],
                  });
                  setMcpForm({ name: '', command: '', args: '' });
                }}
              >
                Add Server
              </button>
            </div>
          </div>
        )}
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
            {skills.map((skill, i) => (
              <button
                key={`skill-${skill.name}-${i}`}
                className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md bg-secondary/40 hover:bg-secondary/70 text-[11px] text-left transition-colors"
                onClick={() => {
                  const input = document.querySelector('textarea');
                  if (input) {
                    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                    nativeSet?.call(input, input.value + `@${skill.name} `);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.focus();
                  }
                }}
                title={`Click to mention @${skill.name} in chat`}
              >
                <span className="mt-0.5 shrink-0">⚡</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{skill.name}</p>
                  {skill.description && <p className="text-muted-foreground truncate">{skill.description}</p>}
                </div>
              </button>
            ))}
          </div>
        )}
        <button
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors',
            showAgents && 'bg-secondary',
          )}
          onClick={() => { setShowAgents(!showAgents); if (!showAgents) loadAgents(); }}
        >
          <GitBranch className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
          Agents
        </button>
        {showAgents && (
          <div className="ml-6 mr-2 mb-1 mt-0.5 space-y-1">
            {agentsLoading && <p className="text-[11px] text-muted-foreground/60 py-1">Loading...</p>}
            {!agentsLoading && agents.length === 0 && (
              <div className="text-[11px] text-muted-foreground/60 py-1 space-y-1">
                <p>No agents found.</p>
                <p className="text-[10px]">Add <code className="bg-secondary px-1 rounded">.md</code> files to <code className="bg-secondary px-1 rounded">.github/agents/</code></p>
              </div>
            )}
            {agents.map((agent, i) => (
              <button
                key={`agent-${agent.name}-${i}`}
                className="w-full flex items-start gap-2 px-2 py-1.5 rounded-md bg-secondary/40 hover:bg-secondary/70 text-[11px] text-left transition-colors"
                onClick={() => {
                  const input = document.querySelector('textarea');
                  if (input) {
                    const nativeSet = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
                    nativeSet?.call(input, input.value + `@${agent.name} `);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.focus();
                  }
                }}
                title={`Click to mention @${agent.name} in chat`}
              >
                <span className="mt-0.5 shrink-0">🤖</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground truncate">{agent.name}</p>
                  {agent.description && <p className="text-muted-foreground truncate">{agent.description}</p>}
                </div>
              </button>
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
      <div className="px-3">
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
          data-testid="add-project-button"
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors"
          onClick={handleOpenProject}
        >
          <FolderPlusIcon className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
          Add project
        </button>
      </div>
      {/* end scrollable body */}
      </div>
      {/* Settings */}
      <div className="px-3 mb-1 shrink-0">
        <button
          data-testid="settings-button"
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          onClick={() => setShowSettings(true)}
        >
          <Settings className="w-[18px] h-[18px]" strokeWidth={1.5} />
          Settings
        </button>
      </div>
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
              data-testid="logout-button"
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
              data-testid="login-button"
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-foreground hover:bg-secondary transition-colors"
              onClick={handleLogin}
              disabled={loginLoading}
            >
              <LogIn className="w-[18px] h-[18px] text-muted-foreground" strokeWidth={1.5} />
              {loginLoading ? 'Opening login...' : 'Sign in with GitHub'}
            </button>
            <button
              data-testid="check-auth-button"
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
