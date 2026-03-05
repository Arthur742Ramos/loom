import React, { useState, useRef, useEffect } from 'react';
import { useAppStore, ChatMessage, ModelInfo } from '../store/appStore';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import {
  MessageSquare, GitCompare, TerminalSquare, Send, RefreshCw, ChevronDown, Check, Loader2, Square,
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

const THINKING_SUMMARY_LIMIT = 60;
const THINKING_PREVIEW_LIMIT = 500;

const summarizeThinking = (thinking: string): string => {
  const normalized = thinking.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'Thinking...';
  return normalized.length > THINKING_SUMMARY_LIMIT
    ? `${normalized.slice(0, THINKING_SUMMARY_LIMIT)}…`
    : normalized;
};

const previewThinking = (thinking: string, showFull: boolean): string => {
  if (showFull || thinking.length <= THINKING_PREVIEW_LIMIT) return thinking;
  return `${thinking.slice(0, THINKING_PREVIEW_LIMIT)}…`;
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
  const appendThinking = useAppStore((s) => s.appendThinking);
  const addToolCall = useAppStore((s) => s.addToolCall);
  const updateToolCallStatus = useAppStore((s) => s.updateToolCallStatus);
  const projectPath = useAppStore((s) => s.projectPath);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const githubUser = useAppStore((s) => s.githubUser);
  const reasoningEffort = useAppStore((s) => s.reasoningEffort);
  const setReasoningEffort = useAppStore((s) => s.setReasoningEffort);
  const permissionMode = useAppStore((s) => s.permissionMode);
  const setPermissionMode = useAppStore((s) => s.setPermissionMode);
  const mcpServers = useAppStore((s) => s.mcpServers);
  const showToolOutputDetails = useAppStore((s) => s.showToolOutputDetails);
  const [input, setInput] = useState('');
  const [pendingPermission, setPendingPermission] = useState<{
    kind: string; toolName?: string; toolArgs?: any; replyChannel: string;
  } | null>(null);
  const [pendingUserInput, setPendingUserInput] = useState<{
    question: string; choices?: string[]; allowFreeform?: boolean; replyChannel: string;
  } | null>(null);
  const [userInputAnswer, setUserInputAnswer] = useState('');
  const [agentStatusMap, setAgentStatusMap] = useState<Record<string, string>>({});
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [expandedThinkingByMessage, setExpandedThinkingByMessage] = useState<Record<string, boolean>>({});
  const [expandedFullThinkingByMessage, setExpandedFullThinkingByMessage] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamCleanupByThreadRef = useRef<Record<string, () => void>>({});
  const activeRequestIdByThreadRef = useRef<Record<string, string>>({});

  const thread = threads.find((t) => t.id === activeThreadId);
  const threadProjectPath = thread?.projectPath || projectPath || '';
  const agentStatus = (activeThreadId && agentStatusMap[activeThreadId]) || '';

  const scrollToBottom = () => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Scroll on new messages and during streaming content growth.
  useEffect(() => {
    if (!thread) return;
    scrollToBottom();
  }, [thread?.messages, agentStatus]);

  useEffect(() => () => {
    Object.values(streamCleanupByThreadRef.current).forEach((cleanup) => cleanup());
    streamCleanupByThreadRef.current = {};
    activeRequestIdByThreadRef.current = {};
  }, []);

  // Listen for permission requests from the agent backend.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const unsub = api.on('agent:permission-request', (threadId: string, data: any) => {
      if (threadId !== activeThreadId) return;
      setPendingPermission(data);
    });
    return unsub;
  }, [activeThreadId]);

  const respondToPermission = (approved: boolean) => {
    if (!pendingPermission) return;
    window.electronAPI?.sendReply(pendingPermission.replyChannel, approved);
    setPendingPermission(null);
  };

  // Listen for user-input requests (ask_user tool) from the agent backend.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const unsub = api.on('agent:user-input-request', (threadId: string, data: any) => {
      if (threadId !== activeThreadId) return;
      setPendingUserInput(data);
      setUserInputAnswer('');
    });
    return unsub;
  }, [activeThreadId]);

  const respondToUserInput = (answer: string) => {
    if (!pendingUserInput) return;
    window.electronAPI?.sendReply(pendingUserInput.replyChannel, answer);
    setPendingUserInput(null);
    setUserInputAnswer('');
  };

  const toggleThinking = (messageId: string) => {
    setExpandedThinkingByMessage((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  };

  const showFullThinking = (messageId: string) => {
    setExpandedFullThinkingByMessage((prev) => ({ ...prev, [messageId]: true }));
  };

  const handleCancel = () => {
    if (!thread || !activeThreadId) return;
    window.electronAPI?.send('agent:cancel', activeThreadId);
  };

  const handleSend = () => {
    if (!thread || !activeThreadId) return;
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    const threadId = activeThreadId;
    const requestId = crypto.randomUUID();
    streamCleanupByThreadRef.current[threadId]?.();

    const userMsg: ChatMessage = {
      id: `msg-${crypto.randomUUID()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
      status: 'done',
    };
    addMessage(threadId, userMsg);

    const assistantMsgId = `msg-${crypto.randomUUID()}`;
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
    };
    addMessage(threadId, assistantMsg);
    updateThread(threadId, { status: 'running' });
    setAgentStatusMap((prev) => ({ ...prev, [threadId]: '' }));
    setInput('');

    if (window.electronAPI) {
      const api = window.electronAPI;
      activeRequestIdByThreadRef.current[threadId] = requestId;
      let chunkBuffer = '';
      let rafId: number | null = null;
      let cleanedUp = false;
      let unsub: (() => void) | undefined;

      const flushChunks = () => {
        rafId = null;
        if (chunkBuffer) {
          appendToMessage(threadId, assistantMsgId, chunkBuffer);
          chunkBuffer = '';
        }
      };

      const cleanup = (flushPending = false) => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (flushPending && chunkBuffer) {
          appendToMessage(threadId, assistantMsgId, chunkBuffer);
          chunkBuffer = '';
        }
        unsub?.();
        if (streamCleanupByThreadRef.current[threadId] === cleanup) {
          delete streamCleanupByThreadRef.current[threadId];
        }
        if (activeRequestIdByThreadRef.current[threadId] === requestId) {
          delete activeRequestIdByThreadRef.current[threadId];
        }
      };

      const handler = (streamThreadId: string, data: any) => {
        if (streamThreadId !== threadId) return;
        if (data?.requestId && data.requestId !== requestId) return;
        if (activeRequestIdByThreadRef.current[threadId] !== requestId) return;

        if (data.type === 'turn_reset') {
          // New assistant turn — replace accumulated content with fresh output.
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          chunkBuffer = '';
          updateMessage(threadId, assistantMsgId, { content: '' });
        } else if (data.type === 'chunk') {
          if (!data.content) return;
          chunkBuffer += data.content;
          if (rafId === null) {
            rafId = requestAnimationFrame(flushChunks);
          }
        } else if (data.type === 'thinking') {
          if (data.content) {
            appendThinking(threadId, assistantMsgId, data.content);
          }
        } else if (data.type === 'tool_start') {
          const toolCallId = data.toolCallId || `tool-${crypto.randomUUID()}`;
          addToolCall(threadId, assistantMsgId, {
            id: toolCallId,
            toolName: data.toolName || 'tool',
            status: 'running',
          });
          setAgentStatusMap((prev) => ({ ...prev, [threadId]: `Running ${data.toolName || 'tool'}` }));
        } else if (data.type === 'tool_end') {
          if (data.toolCallId) {
            updateToolCallStatus(
              threadId,
              assistantMsgId,
              data.toolCallId,
              data.success === false || data.error ? 'error' : 'done',
              {
                result: typeof data.result === 'string' ? data.result : undefined,
                error: typeof data.error === 'string' ? data.error : undefined,
              },
            );
          }
          setAgentStatusMap((prev) => ({ ...prev, [threadId]: '' }));
        } else if (data.type === 'status') {
          setAgentStatusMap((prev) => ({ ...prev, [threadId]: data.status || '' }));
        } else if (data.type === 'done') {
          cleanup(true);
          if (typeof data.content === 'string' && data.content.length > 0) {
            updateMessage(threadId, assistantMsgId, { content: data.content });
          }
          updateMessage(threadId, assistantMsgId, { status: 'done' });
          updateThread(threadId, { status: 'completed' });
          setAgentStatusMap((prev) => ({ ...prev, [threadId]: '' }));
        } else if (data.type === 'error') {
          cleanup(true);
          updateMessage(threadId, assistantMsgId, { status: 'error', content: `Error: ${data.content}` });
          updateThread(threadId, { status: 'error' });
          setAgentStatusMap((prev) => ({ ...prev, [threadId]: '' }));
        }
      };
      streamCleanupByThreadRef.current[threadId] = cleanup;
      unsub = api.on('agent:stream', handler);
      api.send('agent:send', {
        threadId,
        requestId,
        cliSessionId: thread.cliSessionId,
        message: trimmedInput,
        model: selectedModel,
        reasoningEffort,
        permissionMode,
        mcpServers,
        context: { cwd: threadProjectPath },
      });
    } else {
      setTimeout(() => {
        appendToMessage(threadId, assistantMsgId,
          "The Copilot CLI backend requires the desktop app (Electron).\n\n" +
          "Install the Copilot CLI: `npm install -g @githubnext/github-copilot-cli`\n" +
          "Then run this app as a desktop application."
        );
        updateMessage(threadId, assistantMsgId, { status: 'done' });
        updateThread(threadId, { status: 'completed' });
      }, 500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const statusBadgeVariant = (s: string) => {
    if (s === 'running') return 'default' as const;
    if (s === 'error') return 'destructive' as const;
    return 'secondary' as const;
  };

  if (!thread) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" data-testid="thread-panel">
      {/* Header — Codex style */}
      <div className="flex items-center justify-between px-8 pt-7 pb-4 shrink-0">
        {editingTitle ? (
          <input
            className="text-xl font-semibold text-foreground bg-transparent outline-none border-b-2 border-primary min-w-[120px]"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              if (titleDraft.trim()) updateThread(thread.id, { title: titleDraft.trim() });
              setEditingTitle(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditingTitle(false);
            }}
            autoFocus
          />
        ) : (
          <h2
            className="text-xl font-semibold text-foreground cursor-pointer hover:text-primary/80 transition-colors"
            onDoubleClick={() => { setEditingTitle(true); setTitleDraft(thread.title); }}
            title="Double-click to rename"
          >{thread.title}</h2>
        )}
        <div className="flex gap-0.5 bg-secondary rounded-lg p-1">
          <button
            data-testid="tab-chat"
            className={cn('inline-flex items-center gap-1.5 px-3 h-7 text-xs font-medium rounded-md transition-all',
              activeTab === 'chat' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare className="w-3.5 h-3.5" /> Chat
          </button>
          <button
            data-testid="tab-diff"
            className={cn('inline-flex items-center gap-1.5 px-3 h-7 text-xs font-medium rounded-md transition-all',
              activeTab === 'diff' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
            onClick={() => setActiveTab('diff')}
          >
            <GitCompare className="w-3.5 h-3.5" /> Diff
          </button>
          <button
            data-testid="tab-terminal"
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
              {thread.messages.map((msg) => {
                const isActiveStreamingAssistant = msg.role === 'assistant'
                  && msg.status === 'streaming'
                  && msg === thread.messages[thread.messages.length - 1];
                const hasAssistantDetails = msg.role === 'assistant'
                  && (
                    Boolean(msg.toolCalls?.length)
                    || Boolean(msg.thinking)
                    || (isActiveStreamingAssistant && Boolean(agentStatus))
                  );
                const isThinkingExpanded = Boolean(expandedThinkingByMessage[msg.id]);
                const isLongThinking = Boolean(msg.thinking && msg.thinking.length > THINKING_PREVIEW_LIMIT);
                const isFullThinkingExpanded = Boolean(expandedFullThinkingByMessage[msg.id]);
                const thinkingSummary = msg.thinking ? summarizeThinking(msg.thinking) : '';
                const thinkingContent = msg.thinking
                  ? previewThinking(msg.thinking, isFullThinkingExpanded)
                  : '';

                return (
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
                      {hasAssistantDetails && (
                        <div className="mb-2 space-y-1.5">
                          {msg.thinking && (
                            <div className="thinking-block" data-testid="thinking-block">
                              <button
                                type="button"
                                className="thinking-toggle"
                                data-testid="thinking-toggle"
                                onClick={() => toggleThinking(msg.id)}
                              >
                                <ChevronDown
                                  className={cn(
                                    'w-3 h-3 shrink-0 transition-transform',
                                    isThinkingExpanded ? 'rotate-0' : '-rotate-90',
                                  )}
                                />
                                <span className="thinking-toggle-label">Thinking</span>
                                {!isThinkingExpanded && (
                                  <span className="thinking-toggle-summary">{thinkingSummary}</span>
                                )}
                                {!isThinkingExpanded && isActiveStreamingAssistant && (
                                  <span className="thinking-live-indicator" aria-hidden="true">
                                    <span className="thinking-live-dot" />
                                    <span className="thinking-live-dot" />
                                    <span className="thinking-live-dot" />
                                  </span>
                                )}
                              </button>
                              {isThinkingExpanded && (
                                <div className="thinking-content">
                                  <div className="thinking-content-text">{thinkingContent}</div>
                                  {isLongThinking && !isFullThinkingExpanded && (
                                    <button
                                      type="button"
                                      className="thinking-show-more"
                                      data-testid="thinking-show-more"
                                      onClick={() => showFullThinking(msg.id)}
                                    >
                                      Show more
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {isActiveStreamingAssistant && agentStatus && (
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                              <span className="truncate">{agentStatus}</span>
                            </div>
                          )}
                          {msg.toolCalls && msg.toolCalls.length > 0 && (
                            <div className="space-y-1">
                              {msg.toolCalls.map((toolCall) => (
                                <div key={toolCall.id} className="text-[11px] text-muted-foreground/80">
                                  <div className="flex items-center gap-2">
                                    {toolCall.status === 'running' ? (
                                      <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                                    ) : toolCall.status === 'error' ? (
                                      <span className="text-destructive">✕</span>
                                    ) : (
                                      <Check className="w-3 h-3 shrink-0 text-emerald-600" />
                                    )}
                                    <span className="truncate">{toolCall.toolName}</span>
                                  </div>
                                  {showToolOutputDetails && toolCall.result && (
                                    <div className="pl-5 mt-0.5 text-muted-foreground/70 whitespace-pre-wrap break-words">
                                      {toolCall.result}
                                    </div>
                                  )}
                                  {toolCall.error && (
                                    <div className="pl-5 mt-0.5 text-destructive whitespace-pre-wrap break-words">
                                      {toolCall.error}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
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
                    </div>
                  </div>
                );
              })}
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
                data-testid="thread-input"
                data-loom-chat-input="true"
                ref={inputRef}
                className="flex-1 px-3.5 py-2.5 bg-transparent border-none text-sm font-sans resize-none outline-none max-h-[120px] leading-relaxed text-foreground placeholder:text-muted-foreground"
                placeholder="Ask Copilot to work on something..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              {thread.status === 'running' ? (
                <Button
                  data-testid="thread-stop"
                  size="icon"
                  variant="destructive"
                  className="h-9 w-9 rounded-[10px] shrink-0"
                  onClick={handleCancel}
                >
                  <Square className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  data-testid="thread-send"
                  size="icon"
                  className="h-9 w-9 rounded-[10px] shrink-0"
                  onClick={handleSend}
                  disabled={!input.trim()}
                >
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1">
              <div className="flex items-center gap-2">
                <ModelPicker value={selectedModel} onChange={setSelectedModel} />
                {(() => {
                  const currentModel = useAppStore.getState().availableModels.find(m => m.id === selectedModel);
                  const supported = currentModel?.supportedReasoningEfforts;
                  const levels = (['low', 'medium', 'high', 'xhigh'] as const).filter(
                    l => !supported || supported.length === 0 || supported.includes(l)
                  );
                  return levels.length > 0 ? (
                    <div className="flex items-center gap-0.5 bg-secondary/50 rounded-md p-0.5">
                      {levels.map((level) => (
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
                          {level === 'low' ? '⚡' : level === 'medium' ? '⚖️' : level === 'high' ? '🧠' : '💎'}
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}
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
  const [files, setFiles] = useState<any[]>([]);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [staged, setStaged] = useState(false);

  const loadDiff = async () => {
    setLoading(true);
    try {
      const api = window.electronAPI;
      if (api) {
        const result = await api.invoke('git:diff', projectPath, staged);
        const parsed = result.files || [];
        setFiles(parsed);
        setExpandedFiles(new Set(parsed.map((f: any) => f.path)));
      }
    } catch (err) {
      console.error('Failed to load diff:', err);
      setFiles([]);
    }
    setLoading(false);
  };

  useEffect(() => { loadDiff(); }, [projectPath, staged]);

  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });
  };

  const statusIcon = (s: string) =>
    s === 'added' ? '🟢' : s === 'deleted' ? '🔴' : s === 'renamed' ? '🔵' : '🟡';

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" data-testid="diff-view">
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-card shrink-0">
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={loadDiff}>
          <RefreshCw className="w-3 h-3" /> Refresh
        </Button>
        <div className="flex items-center gap-0.5 bg-secondary/50 rounded-md p-0.5">
          <button onClick={() => setStaged(false)}
            className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-all',
              !staged ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >Unstaged</button>
          <button onClick={() => setStaged(true)}
            className={cn('px-2 py-0.5 rounded text-[10px] font-medium transition-all',
              staged ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
          >Staged</button>
        </div>
        {files.length > 0 && (
          <span className="text-[11px] text-muted-foreground ml-auto">
            {files.length} file{files.length !== 1 ? 's' : ''} ·{' '}
            <span className="text-green-600">+{files.reduce((s: number, f: any) => s + f.additions, 0)}</span>{' '}
            <span className="text-red-500">-{files.reduce((s: number, f: any) => s + f.deletions, 0)}</span>
          </span>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && <p className="p-4 text-sm text-muted-foreground">Loading diff...</p>}
        {!loading && files.length === 0 && (
          <div className="flex flex-col items-center justify-center min-h-[200px] text-muted-foreground/60 text-sm">
            No {staged ? 'staged' : 'unstaged'} changes
          </div>
        )}
        {files.map((file: any) => (
          <div key={file.path} className="border-b last:border-b-0">
            {/* File header */}
            <button
              className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-secondary/40 transition-colors"
              onClick={() => toggleFile(file.path)}
            >
              <ChevronDown className={cn('w-3.5 h-3.5 text-muted-foreground transition-transform',
                !expandedFiles.has(file.path) && '-rotate-90')} />
              <span className="text-xs">{statusIcon(file.status)}</span>
              <span className="text-[13px] font-mono text-foreground truncate flex-1">{file.path}</span>
              {file.oldPath && (
                <span className="text-[11px] text-muted-foreground">← {file.oldPath}</span>
              )}
              <span className="text-[11px] shrink-0">
                <span className="text-green-600">+{file.additions}</span>
                {' '}
                <span className="text-red-500">-{file.deletions}</span>
              </span>
            </button>
            {/* Hunks */}
            {expandedFiles.has(file.path) && file.hunks.map((hunk: any, hi: number) => (
              <div key={hi} className="border-t border-border/40">
                <div className="px-4 py-1 bg-blue-50/50 text-[11px] font-mono text-blue-600">
                  @@ -{hunk.oldStart},{hunk.oldCount} +{hunk.newStart},{hunk.newCount} @@
                  {hunk.header && <span className="text-muted-foreground ml-2">{hunk.header}</span>}
                </div>
                <div className="font-mono text-[12px] leading-[1.6]">
                  {hunk.lines.map((line: any, li: number) => (
                    <div key={li} className={cn('flex',
                      line.type === 'add' && 'bg-green-50',
                      line.type === 'del' && 'bg-red-50',
                    )}>
                      <span className={cn('w-[52px] shrink-0 text-right pr-2 select-none text-[11px] border-r',
                        line.type === 'add' ? 'text-green-400 border-green-200 bg-green-50' :
                        line.type === 'del' ? 'text-red-400 border-red-200 bg-red-50' :
                        'text-muted-foreground/40 border-border/30',
                      )}>
                        {line.oldLine ?? ''}
                      </span>
                      <span className={cn('w-[52px] shrink-0 text-right pr-2 select-none text-[11px] border-r',
                        line.type === 'add' ? 'text-green-400 border-green-200 bg-green-50' :
                        line.type === 'del' ? 'text-red-400 border-red-200 bg-red-50' :
                        'text-muted-foreground/40 border-border/30',
                      )}>
                        {line.newLine ?? ''}
                      </span>
                      <span className={cn('w-5 shrink-0 text-center select-none text-[11px]',
                        line.type === 'add' ? 'text-green-600' :
                        line.type === 'del' ? 'text-red-500' : 'text-transparent',
                      )}>
                        {line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}
                      </span>
                      <span className={cn('flex-1 px-2 whitespace-pre select-text',
                        line.type === 'add' ? 'text-green-900' :
                        line.type === 'del' ? 'text-red-900' : 'text-foreground',
                      )}>
                        {line.content}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

const TerminalView: React.FC<{ threadId: string; projectPath: string }> = ({ threadId, projectPath }) => {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!termRef.current) return;
    const initTerminal = async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        const term = new Terminal({
          theme: {
            background: '#1a1b26',
            foreground: '#c0caf5',
            cursor: '#c0caf5',
            cursorAccent: '#1a1b26',
            selectionBackground: '#33467c',
            selectionForeground: '#c0caf5',
            black: '#15161e',
            red: '#f7768e',
            green: '#9ece6a',
            yellow: '#e0af68',
            blue: '#7aa2f7',
            magenta: '#bb9af7',
            cyan: '#7dcfff',
            white: '#a9b1d6',
            brightBlack: '#414868',
            brightRed: '#f7768e',
            brightGreen: '#9ece6a',
            brightYellow: '#e0af68',
            brightBlue: '#7aa2f7',
            brightMagenta: '#bb9af7',
            brightCyan: '#7dcfff',
            brightWhite: '#c0caf5',
          },
          fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          fontSize: 13,
          cursorBlink: true,
        });
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(termRef.current!);
        fitAddon.fit();

        const api = window.electronAPI;
        if (api) {
          const result = await api.invoke('terminal:create', threadId, projectPath);
          if (result.pid) {
            setConnected(true);
            term.onData((data: string) => api.send('terminal:data', threadId, data));
            const unsub = api.on('terminal:data', (id: string, data: string) => {
              if (id === threadId) term.write(data);
            });
            const ro = new ResizeObserver(() => fitAddon.fit());
            ro.observe(termRef.current!);
            return () => { unsub(); ro.disconnect(); term.dispose(); };
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
        setError(err instanceof Error ? err.message : 'Failed to initialize terminal');
      }
    };
    initTerminal();
  }, [threadId, projectPath]);

  return (
    <div className="flex-1 flex flex-col relative bg-background">
      <div className="flex-1 p-2 bg-[#1a1b26]" ref={termRef} />
      {!connected && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1a1b26] text-[#c0caf5] text-sm">
          Connecting terminal...
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#1a1b26] text-red-400 text-sm px-4 text-center">
          Terminal error: {error}
        </div>
      )}
    </div>
  );
};
