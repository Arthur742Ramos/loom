import React, { useState, useRef, useEffect } from 'react';
import { useAppStore, ChatMessage, ModelInfo } from '../store/appStore';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import {
  MessageSquare, GitCompare, TerminalSquare, Send, RefreshCw, ChevronDown, Check, Loader2,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { MarkdownMessage } from './MarkdownMessage';
import { LoomIcon } from './LoomIcon';

const ModelPicker: React.FC<{
  value: string;
  onChange: (model: string) => void;
}> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const availableModels = useAppStore((s) => s.availableModels);
  const modelsLoading = useAppStore((s) => s.modelsLoading);
  const fetchModels = useAppStore((s) => s.fetchModels);
  const current = availableModels.find((m) => m.id === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (open) {
      setSearch('');
      searchRef.current?.focus();
    }
  }, [open]);

  const filtered = availableModels.filter(
    (m) =>
      m.label.toLowerCase().includes(search.toLowerCase()) ||
      m.provider.toLowerCase().includes(search.toLowerCase()) ||
      m.id.toLowerCase().includes(search.toLowerCase()),
  );

  // Group by provider
  const providers = [...new Set(filtered.map((m) => m.provider))];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/80 transition-colors"
      >
        <span className="font-medium">{current?.label || value}</span>
        <ChevronDown className={cn('w-3 h-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-64 bg-card border rounded-lg shadow-lg z-50 flex flex-col max-h-[380px]">
          {/* Search + refresh */}
          <div className="flex items-center gap-1 p-2 border-b">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none px-1"
            />
            <button
              onClick={(e) => { e.stopPropagation(); fetchModels(); }}
              className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors"
              title="Refresh models from GitHub"
            >
              {modelsLoading
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <RefreshCw className="w-3 h-3" />}
            </button>
          </div>
          {/* Model list */}
          <div className="overflow-y-auto py-1">
            {providers.length === 0 && (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">No models found</p>
            )}
            {providers.map((provider) => {
              const models = filtered.filter((m) => m.provider === provider);
              return (
                <div key={provider}>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/70 uppercase tracking-wider sticky top-0 bg-card">
                    {provider}
                  </div>
                  {models.map((m) => (
                    <button
                      key={m.id}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-1.5 text-[12px] transition-colors',
                        m.id === value
                          ? 'text-foreground bg-secondary/60'
                          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40',
                      )}
                      onClick={() => { onChange(m.id); setOpen(false); }}
                    >
                      <Check className={cn('w-3 h-3 shrink-0', m.id === value ? 'opacity-100' : 'opacity-0')} />
                      <span className="truncate">{m.label}</span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const ThreadPanel: React.FC = () => {
  const activeThreadId = useAppStore((s) => s.activeThreadId);
  const threads = useAppStore((s) => s.threads);
  const activeTab = useAppStore((s) => s.activeTab);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const addMessage = useAppStore((s) => s.addMessage);
  const appendToMessage = useAppStore((s) => s.appendToMessage);
  const updateMessage = useAppStore((s) => s.updateMessage);
  const updateThread = useAppStore((s) => s.updateThread);
  const projectPath = useAppStore((s) => s.projectPath);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const githubUser = useAppStore((s) => s.githubUser);
  const reasoningEffort = useAppStore((s) => s.reasoningEffort);
  const setReasoningEffort = useAppStore((s) => s.setReasoningEffort);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const [input, setInput] = useState('');
  const [pendingPermission, setPendingPermission] = useState<{
    kind: string; toolName?: string; toolArgs?: any; replyChannel: string;
  } | null>(null);
  const [pendingUserInput, setPendingUserInput] = useState<{
    question: string; choices?: string[]; allowFreeform?: boolean; replyChannel: string;
  } | null>(null);
  const [userInputAnswer, setUserInputAnswer] = useState('');
  const [agentStatus, setAgentStatus] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const thread = threads.find((t) => t.id === activeThreadId);
  if (!thread) return null;
  const threadProjectPath = thread.projectPath || projectPath || '';

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Scroll on new messages and during streaming content growth.
  useEffect(() => { scrollToBottom(); }, [thread.messages, agentStatus]);

  // Listen for permission requests from the agent backend.
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).require) return;
    const { ipcRenderer } = (window as any).require('electron');
    const handler = (_: any, threadId: string, data: any) => {
      if (threadId !== activeThreadId) return;
      setPendingPermission(data);
    };
    ipcRenderer.on('agent:permission-request', handler);
    return () => { ipcRenderer.removeListener('agent:permission-request', handler); };
  }, [activeThreadId]);

  const respondToPermission = (approved: boolean) => {
    if (!pendingPermission) return;
    const { ipcRenderer } = (window as any).require('electron');
    ipcRenderer.send(pendingPermission.replyChannel, approved);
    setPendingPermission(null);
  };

  // Listen for user-input requests (ask_user tool) from the agent backend.
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).require) return;
    const { ipcRenderer } = (window as any).require('electron');
    const handler = (_: any, threadId: string, data: any) => {
      if (threadId !== activeThreadId) return;
      setPendingUserInput(data);
      setUserInputAnswer('');
    };
    ipcRenderer.on('agent:user-input-request', handler);
    return () => { ipcRenderer.removeListener('agent:user-input-request', handler); };
  }, [activeThreadId]);

  const respondToUserInput = (answer: string) => {
    if (!pendingUserInput) return;
    const { ipcRenderer } = (window as any).require('electron');
    ipcRenderer.send(pendingUserInput.replyChannel, answer);
    setPendingUserInput(null);
    setUserInputAnswer('');
  };

  const handleSend = () => {
    if (!input.trim() || !activeThreadId) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      status: 'done',
    };
    addMessage(activeThreadId, userMsg);

    const assistantMsgId = `msg-${Date.now()}-assistant`;
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
    };
    addMessage(activeThreadId, assistantMsg);
    updateThread(activeThreadId, { status: 'running' });

    if (typeof window !== 'undefined' && (window as any).require) {
      const { ipcRenderer } = (window as any).require('electron');
      ipcRenderer.send('agent:send', {
        threadId: activeThreadId,
        cliSessionId: thread.cliSessionId,
        message: input.trim(),
        model: selectedModel,
        reasoningEffort,
        permissionMode,
        context: { cwd: threadProjectPath },
      });

      let gotChunks = false;
      let chunkBuffer = '';
      let rafId: number | null = null;

      const flushChunks = () => {
        rafId = null;
        if (chunkBuffer) {
          appendToMessage(activeThreadId!, assistantMsgId, chunkBuffer);
          chunkBuffer = '';
        }
      };

      const handler = (_: any, threadId: string, data: any) => {
        if (threadId !== activeThreadId) return;
        if (data.type === 'chunk') {
          gotChunks = true;
          chunkBuffer += data.content;
          if (rafId === null) {
            rafId = requestAnimationFrame(flushChunks);
          }
        } else if (data.type === 'thinking') {
          setThinkingContent((prev) => prev + data.content);
        } else if (data.type === 'status') {
          setAgentStatus(data.status || '');
        } else if (data.type === 'done') {
          if (rafId !== null) cancelAnimationFrame(rafId);
          if (chunkBuffer) {
            appendToMessage(threadId, assistantMsgId, chunkBuffer);
            chunkBuffer = '';
          }
          // Always prefer the final authoritative content from the SDK.
          // Streamed deltas may include intermediate tool output that
          // differs from the clean final assistant message.
          if (data.content) {
            updateMessage(threadId, assistantMsgId, { content: data.content });
          }
          updateMessage(threadId, assistantMsgId, { status: 'done' });
          updateThread(threadId, { status: 'completed' });
          setAgentStatus('');
          setThinkingContent('');
          ipcRenderer.removeListener('agent:stream', handler);
        } else if (data.type === 'error') {
          if (rafId !== null) cancelAnimationFrame(rafId);
          updateMessage(threadId, assistantMsgId, { status: 'error', content: `Error: ${data.content}` });
          updateThread(threadId, { status: 'error' });
          setAgentStatus('');
          setThinkingContent('');
          ipcRenderer.removeListener('agent:stream', handler);
        }
      };
      ipcRenderer.on('agent:stream', handler);
    } else {
      setTimeout(() => {
        appendToMessage(activeThreadId!, assistantMsgId,
          "The Copilot CLI backend requires the desktop app (Electron).\n\n" +
          "Install the Copilot CLI: `npm install -g @githubnext/github-copilot-cli`\n" +
          "Then run this app as a desktop application."
        );
        updateMessage(activeThreadId!, assistantMsgId, { status: 'done' });
        updateThread(activeThreadId!, { status: 'completed' });
      }, 500);
    }

    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const statusBadgeVariant = (s: string) => {
    if (s === 'running') return 'default' as const;
    if (s === 'error') return 'destructive' as const;
    return 'secondary' as const;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header — Codex style */}
      <div className="flex items-center justify-between px-8 pt-7 pb-4 shrink-0">
        <h2 className="text-xl font-semibold text-foreground">{thread.title}</h2>
        <div className="flex gap-0.5 bg-secondary rounded-lg p-1">
          <button
            className={cn('inline-flex items-center gap-1.5 px-3 h-7 text-xs font-medium rounded-md transition-all',
              activeTab === 'chat' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Chat
          </button>
          <button
            className={cn('inline-flex items-center gap-1.5 px-3 h-7 text-xs font-medium rounded-md transition-all',
              activeTab === 'diff' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => setActiveTab('diff')}
          >
            <GitCompare className="w-3.5 h-3.5" /> Diff
          </button>
          <button
            className={cn('inline-flex items-center gap-1.5 px-3 h-7 text-xs font-medium rounded-md transition-all',
              activeTab === 'terminal' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => setActiveTab('terminal')}
          >
            <TerminalSquare className="w-3.5 h-3.5" /> Terminal
          </button>
        </div>
      </div>

      {/* Chat Tab */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="px-8 py-4">
              {thread.messages.length === 0 && (
                <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 pb-20">
                  <LoomIcon className="w-12 h-12 text-muted-foreground opacity-30" strokeWidth={1} />
                  <p className="text-muted-foreground text-[15px]">Start a conversation to work on this task</p>
                  <p className="text-muted-foreground/60 text-xs">Copilot can write code, run commands, review diffs, and more</p>
                </div>
              )}
              {thread.messages.map((msg) => (
                <div key={msg.id} className={cn('flex gap-3 py-3.5', msg.id !== thread.messages[0]?.id && 'border-t')}>
                  <Avatar className="h-7 w-7 shrink-0">
                    {msg.role === 'user' && githubUser?.avatar_url ? (
                      <AvatarImage src={githubUser.avatar_url} alt={githubUser.login} />
                    ) : null}
                    <AvatarFallback className={cn(
                      msg.role === 'user'
                        ? 'bg-muted text-muted-foreground text-xs'
                        : 'bg-primary/10 text-primary text-xs',
                    )}>
                      {msg.role === 'user'
                        ? (githubUser?.login?.[0]?.toUpperCase() || 'U')
                        : <LoomIcon className="w-3.5 h-3.5" />}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-muted-foreground block mb-0.5">
                      {msg.role === 'user'
                        ? (githubUser?.name || githubUser?.login || 'You')
                        : 'Copilot'}
                    </span>
                    {msg.role === 'assistant' && msg.content && msg.status !== 'streaming' ? (
                      <MarkdownMessage
                        content={msg.content}
                        className="text-[13.5px] leading-relaxed text-foreground select-text"
                      />
                    ) : (
                      <div className="text-[13.5px] leading-relaxed text-foreground whitespace-pre-wrap break-words select-text">
                        {msg.content || (msg.status === 'streaming' && (
                          <span className="inline-flex gap-1 py-1">
                            <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
                            <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
                            <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
                          </span>
                        ))}
                      </div>
                    )}
                    {msg.status === 'error' && (
                      <span className="text-destructive text-[11px] mt-1 block">Failed</span>
                    )}
                    {/* Activity indicator: show what the agent is doing during tool work */}
                    {msg.status === 'streaming' && msg === thread.messages[thread.messages.length - 1] && (agentStatus || thinkingContent) && (
                      <div className="mt-2 space-y-1.5">
                        {agentStatus && (
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                            <span className="truncate">{agentStatus}</span>
                          </div>
                        )}
                        {thinkingContent && (
                          <details className="group" open>
                            <summary className="text-[11px] text-muted-foreground/70 cursor-pointer select-none hover:text-muted-foreground flex items-center gap-1">
                              <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-0 -rotate-90" />
                              Thinking
                            </summary>
                            <div className="mt-1 pl-4 text-[11px] text-muted-foreground/60 whitespace-pre-wrap max-h-[120px] overflow-y-auto leading-relaxed">
                              {thinkingContent}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Permission approval banner */}
          {pendingPermission && (
            <div className="mx-8 mb-1 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-3">
              <span className="text-amber-600 text-lg mt-0.5">🔐</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-900">
                  Allow <span className="font-mono">{pendingPermission.kind}</span> access?
                </p>
                {(() => {
                  const { kind, replyChannel, ...rest } = pendingPermission as any;
                  const details = rest.toolName || rest.command || rest.path || rest.url;
                  return details ? (
                    <p className="text-[11px] text-amber-800 mt-0.5 font-mono truncate">{String(details)}</p>
                  ) : null;
                })()}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="outline"
                  className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50"
                  onClick={() => respondToPermission(false)}
                >Deny</Button>
                <Button size="sm"
                  className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => respondToPermission(true)}
                >Allow</Button>
              </div>
            </div>
          )}

          {/* User-input request banner (ask_user tool) */}
          {pendingUserInput && (
            <div className="mx-8 mb-1 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-blue-600 text-lg">💬</span>
                <p className="text-[13px] font-medium text-blue-900">{pendingUserInput.question}</p>
              </div>
              {pendingUserInput.choices && pendingUserInput.choices.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-7">
                  {pendingUserInput.choices.map((choice: string, i: number) => (
                    <Button key={i} size="sm" variant="outline"
                      className="h-7 text-xs border-blue-300 text-blue-800 hover:bg-blue-100"
                      onClick={() => respondToUserInput(choice)}
                    >{choice}</Button>
                  ))}
                </div>
              )}
              {(pendingUserInput.allowFreeform !== false || !pendingUserInput.choices?.length) && (
                <div className="flex gap-1.5 pl-7">
                  <input
                    type="text"
                    className="flex-1 px-2.5 py-1.5 text-xs bg-white border border-blue-200 rounded-md outline-none focus:ring-1 focus:ring-blue-400 text-foreground placeholder:text-muted-foreground"
                    placeholder="Type your answer..."
                    value={userInputAnswer}
                    onChange={(e) => setUserInputAnswer(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && userInputAnswer.trim()) respondToUserInput(userInputAnswer.trim()); }}
                    autoFocus
                  />
                  <Button size="sm"
                    className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white"
                    disabled={!userInputAnswer.trim()}
                    onClick={() => respondToUserInput(userInputAnswer.trim())}
                  >Send</Button>
                </div>
              )}
            </div>
          )}

          {/* Input */}
          <div className="px-8 pb-6 pt-3">
            <div className="flex items-end bg-secondary/60 border rounded-xl p-1 focus-within:ring-1 focus-within:ring-ring focus-within:border-ring transition-all">
              <textarea
                ref={inputRef}
                className="flex-1 px-3.5 py-2.5 bg-transparent border-none text-sm font-sans resize-none outline-none max-h-[120px] leading-relaxed text-foreground placeholder:text-muted-foreground"
                placeholder="Ask Copilot to work on something..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              <Button
                size="icon"
                className="h-9 w-9 rounded-[10px] shrink-0"
                onClick={handleSend}
                disabled={!input.trim() || thread.status === 'running'}
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1">
              <div className="flex items-center gap-2">
                <ModelPicker value={selectedModel} onChange={setSelectedModel} />
                <div className="flex items-center gap-0.5 bg-secondary/50 rounded-md p-0.5">
                  {(['low', 'medium', 'high'] as const).map((level) => (
                    <button
                      key={level}
                      onClick={() => setReasoningEffort(level)}
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-medium transition-all',
                        reasoningEffort === level
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      title={`Reasoning effort: ${level}`}
                    >
                      {level === 'low' ? '⚡' : level === 'medium' ? '⚖️' : '🧠'}
                    </button>
                  ))}
                </div>
                {/* Permission mode */}
                <div className="flex items-center gap-0.5 bg-secondary/50 rounded-md p-0.5">
                  {(['auto', 'ask', 'deny'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setPermissionMode(mode)}
                      className={cn(
                        'px-1.5 py-0.5 rounded text-[10px] font-medium transition-all',
                        permissionMode === mode
                          ? 'bg-card text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                      title={mode === 'auto' ? 'Auto-approve all actions (yolo mode)'
                        : mode === 'ask' ? 'Ask before running tools'
                        : 'Deny all tool actions'}
                    >
                      {mode === 'auto' ? '🟢 Auto' : mode === 'ask' ? '🟡 Ask' : '🔴 Deny'}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground/60">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Diff Tab */}
      {activeTab === 'diff' && <DiffView projectPath={threadProjectPath} />}

      {/* Terminal Tab */}
      {activeTab === 'terminal' && <TerminalView threadId={thread.id} projectPath={threadProjectPath} />}
    </div>
  );
};

const DiffView: React.FC<{ projectPath: string }> = ({ projectPath }) => {
  const [diff, setDiff] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const loadDiff = async () => {
    setLoading(true);
    if (typeof window !== 'undefined' && (window as any).require) {
      const { ipcRenderer } = (window as any).require('electron');
      const result = await ipcRenderer.invoke('git:diff', projectPath, false);
      setDiff(result.diff || result.error || 'No changes');
    } else {
      setDiff('// Diff viewer — connect to a Git project to see changes');
    }
    setLoading(false);
  };

  useEffect(() => { loadDiff(); }, [projectPath]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-card">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={loadDiff}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <pre className="p-4 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap select-text">
          {loading ? 'Loading diff...' : diff || 'No changes detected'}
        </pre>
      </ScrollArea>
    </div>
  );
};

const TerminalView: React.FC<{ threadId: string; projectPath: string }> = ({ threadId, projectPath }) => {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!termRef.current) return;
    const initTerminal = async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const term = new Terminal({
          theme: {
            background: '#f8f8f8',
            foreground: '#1a1a1a',
            cursor: '#00a37d',
            selectionBackground: '#b4d5fe',
          },
          fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          fontSize: 13,
          cursorBlink: true,
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(termRef.current!);
        fitAddon.fit();

        if (typeof window !== 'undefined' && (window as any).require) {
          const { ipcRenderer } = (window as any).require('electron');
          const result = await ipcRenderer.invoke('terminal:create', threadId, projectPath);
          if (result.pid) {
            setConnected(true);
            term.onData((data: string) => ipcRenderer.send('terminal:data', threadId, data));
            ipcRenderer.on('terminal:data', (_: any, id: string, data: string) => {
              if (id === threadId) term.write(data);
            });
          }
        } else {
          term.write('Terminal available in desktop mode\r\n$ ');
          setConnected(true);
        }

        const ro = new ResizeObserver(() => fitAddon.fit());
        ro.observe(termRef.current!);
        return () => { ro.disconnect(); term.dispose(); };
      } catch (err) {
        console.error('Terminal init error:', err);
      }
    };
    initTerminal();
  }, [threadId, projectPath]);

  return (
    <div className="flex-1 flex flex-col relative bg-background">
      <div className="flex-1 p-2" ref={termRef} />
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
          Connecting terminal...
        </div>
      )}
    </div>
  );
};
