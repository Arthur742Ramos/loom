import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GitHubUser, useAppStore } from '../store/appStore';
import {
  SquarePen, LayoutGrid, Folder, FolderPlus, ListFilter, FolderPlusIcon,
  Trash2, GitBranch, Monitor, LogIn, LogOut, RefreshCw, Settings, Copy, X,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { LoomLogo } from './LoomIcon';

interface MentionableEntry {
  name: string;
  path: string;
  description: string;
}

interface ProjectMcpServer {
  command: string;
  args?: string[];
}

interface AuthLoginCompletePayload {
  authenticated?: boolean;
  user?: unknown;
}

interface AuthGetUserResult {
  authenticated: boolean;
  user?: GitHubUser;
}

interface AuthLoginResult {
  success: boolean;
  userCode?: string;
  verificationUri?: string;
  error?: string;
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Runtime guard for auth payloads from IPC. */
const isGitHubUser = (value: unknown): value is GitHubUser => (
  typeof value === 'object'
  && value !== null
  && typeof (value as GitHubUser).login === 'string'
  && typeof (value as GitHubUser).avatar_url === 'string'
  && (
    (value as GitHubUser).name === null
    || typeof (value as GitHubUser).name === 'string'
  )
);

/** Normalize skill/agent list results from IPC into render-safe entries. */
const toMentionableEntries = (value: unknown): MentionableEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is MentionableEntry => (
    typeof entry === 'object'
    && entry !== null
    && typeof (entry as MentionableEntry).name === 'string'
    && typeof (entry as MentionableEntry).path === 'string'
    && typeof (entry as MentionableEntry).description === 'string'
  ));
};

/** Normalize project MCP server payloads from IPC. */
const toProjectMcpServers = (value: unknown): Record<string, ProjectMcpServer> => {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, ProjectMcpServer> = {};
  for (const [name, config] of Object.entries(value)) {
    if (typeof config !== 'object' || config === null) continue;
    const command = (config as ProjectMcpServer).command;
    const args = (config as ProjectMcpServer).args;
    if (typeof command !== 'string') continue;
    if (args !== undefined && (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string'))) {
      continue;
    }
    result[name] = { command, ...(args ? { args } : {}) };
  }
  return result;
};

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
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);
  const mcpServers = useAppStore((s) => s.mcpServers);
  const addMcpServer = useAppStore((s) => s.addMcpServer);
  const removeMcpServer = useAppStore((s) => s.removeMcpServer);
  const [showMcp, setShowMcp] = useState(false);
  const [mcpForm, setMcpForm] = useState({ name: '', command: '', args: '' });
  const [projectMcp, setProjectMcp] = useState<Record<string, ProjectMcpServer>>({});
  const setShowSettings = useAppStore((s) => s.setShowSettings);
  const insertIntoChatInput = useAppStore((s) => s.insertIntoChatInput);
  const [showSkills, setShowSkills] = useState(false);
  const [skills, setSkills] = useState<MentionableEntry[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [agents, setAgents] = useState<MentionableEntry[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [showThreadFilter, setShowThreadFilter] = useState(false);
  const [threadFilter, setThreadFilter] = useState('');
  const isMountedRef = useRef(true);
  const latestProjectPathRef = useRef<string | null>(projectPath);
  const skillsRequestIdRef = useRef(0);
  const agentsRequestIdRef = useRef(0);
  const projectMcpRequestIdRef = useRef(0);

  useEffect(() => {
    latestProjectPathRef.current = projectPath;
  }, [projectPath]);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  useEffect(() => {
    setProjectMcp({});
    setSkills([]);
    setAgents([]);
  }, [projectPath]);

  const normalizedThreadFilter = useMemo(
    () => threadFilter.trim().toLowerCase(),
    [threadFilter],
  );

  const threadsByProject = useMemo(() => {
    const grouped = new Map<string, typeof threads>();
    for (const thread of threads) {
      const threadProjectPath = thread.projectPath || projectPath;
      if (!threadProjectPath) continue;
      if (normalizedThreadFilter && !thread.title.toLowerCase().includes(normalizedThreadFilter)) {
        continue;
      }
      const existing = grouped.get(threadProjectPath);
      if (existing) {
        existing.push(thread);
      } else {
        grouped.set(threadProjectPath, [thread]);
      }
    }
    return grouped;
  }, [threads, projectPath, normalizedThreadFilter]);

  const loadSkills = async () => {
    const targetProjectPath = projectPath;
    if (!targetProjectPath || !window.electronAPI) return;
    const requestId = ++skillsRequestIdRef.current;
    setSkillsLoading(true);
    try {
      const result = await window.electronAPI.invoke('agent:list-skills', targetProjectPath);
      if (
        !isMountedRef.current
        || requestId !== skillsRequestIdRef.current
        || latestProjectPathRef.current !== targetProjectPath
      ) {
        return;
      }
      setSkills(toMentionableEntries(result));
    } catch (error: unknown) {
      console.warn('Failed to load project skills:', getErrorMessage(error));
      if (
        !isMountedRef.current
        || requestId !== skillsRequestIdRef.current
        || latestProjectPathRef.current !== targetProjectPath
      ) {
        return;
      }
      setSkills([]);
    } finally {
      if (isMountedRef.current && requestId === skillsRequestIdRef.current) {
        setSkillsLoading(false);
      }
    }
  };

  const loadAgents = async () => {
    const targetProjectPath = projectPath;
    if (!targetProjectPath || !window.electronAPI) return;
    const requestId = ++agentsRequestIdRef.current;
    setAgentsLoading(true);
    try {
      const result = await window.electronAPI.invoke('agent:list-agents', targetProjectPath);
      if (
        !isMountedRef.current
        || requestId !== agentsRequestIdRef.current
        || latestProjectPathRef.current !== targetProjectPath
      ) {
        return;
      }
      setAgents(toMentionableEntries(result));
    } catch (error: unknown) {
      console.warn('Failed to load project agents:', getErrorMessage(error));
      if (
        !isMountedRef.current
        || requestId !== agentsRequestIdRef.current
        || latestProjectPathRef.current !== targetProjectPath
      ) {
        return;
      }
      setAgents([]);
    } finally {
      if (isMountedRef.current && requestId === agentsRequestIdRef.current) {
        setAgentsLoading(false);
      }
    }
  };

  const loadProjectMcp = async () => {
    const targetProjectPath = projectPath;
    if (!targetProjectPath || !window.electronAPI) return;
    const requestId = ++projectMcpRequestIdRef.current;
    try {
      const result = await window.electronAPI.invoke('agent:list-project-mcp', targetProjectPath);
      if (
        !isMountedRef.current
        || requestId !== projectMcpRequestIdRef.current
        || latestProjectPathRef.current !== targetProjectPath
      ) {
        return;
      }
      setProjectMcp(toProjectMcpServers(result));
    } catch (error: unknown) {
      console.warn('Failed to load project MCP servers:', getErrorMessage(error));
      if (
        !isMountedRef.current
        || requestId !== projectMcpRequestIdRef.current
        || latestProjectPathRef.current !== targetProjectPath
      ) {
        return;
      }
      setProjectMcp({});
    }
  };

  const handleOpenProject = async () => {
    if (!window.electronAPI) return;
    try {
      const selectedPath = await window.electronAPI.invoke<string | null>('project:select-dir');
      if (typeof selectedPath === 'string' && selectedPath.length > 0) {
        const name = selectedPath.split(/[/\\]/).pop() || selectedPath;
        setProject(selectedPath, name);
      }
    } catch (error: unknown) {
      console.warn('Failed to open project picker:', getErrorMessage(error));
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

  const api = typeof window !== 'undefined' ? window.electronAPI ?? null : null;

  const checkAuthStatus = async () => {
    if (!api) return;
    setLoginLoading(true);
    try {
      const result = await api.invoke<AuthGetUserResult>('auth:get-user');
      if (result.authenticated && result.user) {
        setGitHubUser(result.user);
        fetchModels();
      } else {
        setGitHubUser(null);
      }
    } catch (error: unknown) {
      console.warn('Failed to check auth status:', getErrorMessage(error));
      setGitHubUser(null);
    }
    setLoginLoading(false);
  };

  const handleLogin = async () => {
    if (!api) return;
    setLoginLoading(true);
    setCodeCopied(false);
    try {
      const result = await api.invoke<AuthLoginResult>('auth:login');
      if (result.success && result.userCode && result.verificationUri) {
        setDeviceCode({ userCode: result.userCode, verificationUri: result.verificationUri });
      } else if (!result.success) {
        if (result.error) {
          console.warn('GitHub login request failed:', result.error);
        }
        setLoginLoading(false);
      }
    } catch (error: unknown) {
      console.warn('GitHub login request failed:', getErrorMessage(error));
      setLoginLoading(false);
    }
  };

  const handleCancelLogin = async () => {
    if (api) await api.invoke('auth:login-cancel');
    setDeviceCode(null);
    setLoginLoading(false);
  };

  const handleLogout = async () => {
    if (!api) return;
    await api.invoke('auth:logout');
    setGitHubUser(null);
  };

  // Check auth on mount
  React.useEffect(() => { checkAuthStatus(); }, []);

  // Listen for device flow completion
  useEffect(() => {
    if (!api) return;
    const unsub = api.on('auth:login-complete', (result: unknown) => {
      const payload = (result || {}) as AuthLoginCompletePayload;
      setDeviceCode(null);
      setLoginLoading(false);
      if (payload.authenticated && isGitHubUser(payload.user)) {
        setGitHubUser(payload.user);
        fetchModels();
      }
    });
    return unsub;
  }, []);

  const statusDot: Record<string, string> = {
    idle: 'bg-gray-300',
    running: 'bg-primary animate-pulse',
    completed: 'bg-green-500',
    error: 'bg-red-500',
  };

  return (
    <aside className="w-[280px] flex flex-col pt-10 pb-4 shrink-0" data-testid="sidebar" aria-label="Sidebar navigation">
      {/* Brand */}
      <div className="px-5 mb-6 flex items-center gap-2.5 shrink-0">
        <LoomLogo className="w-7 h-7 p-1" />
        <span className="text-[15px] font-semibold text-foreground">Loom</span>
      </div>

      {/* Scrollable body: nav + skills + threads */}
      <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Nav items */}
      <nav className="px-3 space-y-0.5 mb-6" aria-label="Main navigation">
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
            if (!showMcp) void loadProjectMcp();
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
            {Object.entries(projectMcp).map(([name, config]) => (
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
                  insertIntoChatInput(`@${skill.name} `);
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
                  insertIntoChatInput(`@${agent.name} `);
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
          <button
            aria-label="Create thread"
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
            onClick={() => handleNewThread()}
          >
            <FolderPlus className="w-4 h-4" strokeWidth={1.5} />
          </button>
          <button
            aria-label={showThreadFilter ? 'Hide thread filter' : 'Show thread filter'}
            aria-pressed={showThreadFilter}
            className={cn(
              'text-muted-foreground hover:text-foreground transition-colors p-1',
              (threadFilter || showThreadFilter) && 'text-primary',
            )}
            onClick={() => {
              setShowThreadFilter((prev) => {
                if (prev) setThreadFilter('');
                return !prev;
              });
            }}
            title="Filter threads"
          >
            <ListFilter className="w-4 h-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {showThreadFilter && (
        <div className="px-5 mb-2">
          <input
            className="w-full px-2.5 py-1.5 text-xs bg-secondary/60 border rounded-md text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary"
            placeholder="Filter threads..."
            value={threadFilter}
            onChange={(e) => setThreadFilter(e.target.value)}
            autoFocus
          />
        </div>
      )}

      {/* Projects & threads */}
      <div className="px-3">
        {projects.map((project) => {
          const projectThreads = threadsByProject.get(project.path) || [];
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
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setProject(project.path, project.name);
                  }
                }}
                tabIndex={0}
                role="button"
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
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setActiveThread(thread.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
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
                        aria-label={`Delete thread ${thread.title}`}
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
        {projects.length === 0 && (
          <div className="mx-2 mb-3 rounded-xl border border-dashed border-border/80 bg-secondary/20 px-3 py-5 text-center">
            <p className="text-xs text-muted-foreground mb-2">No project opened yet</p>
            <button
              className="text-xs font-medium text-primary hover:opacity-80 transition-opacity"
              onClick={handleOpenProject}
            >
              Choose a folder to start
            </button>
          </div>
        )}

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
        ) : deviceCode ? (
          <div className="space-y-2.5 px-3 py-2.5" data-testid="device-code-panel">
            <p className="text-xs text-muted-foreground">
              Enter this code on GitHub:
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-center text-base font-mono font-semibold tracking-widest bg-secondary rounded px-2 py-1.5">
                {deviceCode.userCode}
              </code>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded hover:bg-secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(deviceCode.userCode);
                    setCodeCopied(true);
                    setTimeout(() => setCodeCopied(false), 2000);
                  } catch {
                    setCodeCopied(false);
                  }
                }}
                title={codeCopied ? 'Copied!' : 'Copy code'}
              >
                <Copy className={cn('w-3.5 h-3.5', codeCopied && 'text-green-500')} strokeWidth={1.5} />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="w-3 h-3 animate-spin" strokeWidth={1.5} />
                Waiting for authorization…
              </span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-secondary"
                onClick={handleCancelLogin}
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" strokeWidth={1.5} />
              </button>
            </div>
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
              {loginLoading ? 'Connecting…' : 'Sign in with GitHub'}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
