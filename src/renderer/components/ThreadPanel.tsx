import React, {
  lazy, Suspense, useState, useRef, useEffect, useMemo, useCallback, memo,
} from 'react';
import {
  useAppStore,
  ChatMessage,
  GitHubUser,
  ToolCallEntry,
} from '../store/appStore';
import { useShallow } from 'zustand/react/shallow';
import { Button } from './ui/button';
import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';
import {
  MessageSquare, GitCompare, TerminalSquare, Send, ChevronDown, Check, Loader2, Square,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { MarkdownMessage } from './MarkdownMessage';
import { LoomIcon } from './LoomIcon';
import { ModelPicker } from './ModelPicker';
import { TokenCounter } from './TokenCounter';

const THINKING_SUMMARY_LIMIT = 60;
const THINKING_PREVIEW_LIMIT = 500;
const THREAD_ID_SEPARATOR = '\u0000';
const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;

type PendingPermissionRequest = {
  kind: string;
  replyChannel: string;
  [key: string]: unknown;
};

type PendingUserInputRequest = {
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
  replyChannel: string;
};

type AgentStreamPayload = {
  type: string;
  requestId?: string;
  events?: unknown;
  content?: unknown;
  status?: unknown;
  toolCallId?: unknown;
  toolName?: unknown;
  success?: unknown;
  result?: unknown;
  error?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheWriteTokens?: unknown;
  totalTokens?: unknown;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPendingPermissionRequest = (value: unknown): value is PendingPermissionRequest =>
  isPlainObject(value) && typeof value.kind === 'string' && typeof value.replyChannel === 'string';

const isPendingUserInputRequest = (value: unknown): value is PendingUserInputRequest =>
  isPlainObject(value) && typeof value.question === 'string' && typeof value.replyChannel === 'string';

const toAgentStreamPayload = (value: unknown): AgentStreamPayload | null =>
  isPlainObject(value) && typeof value.type === 'string'
    ? value as AgentStreamPayload
    : null;

const formatAgentErrorContent = (value: unknown): string => {
  const message = typeof value === 'string' ? value.trim() : '';
  if (!message) return 'Error: Unknown agent error';
  return message.startsWith('Error:') ? message : `Error: ${message}`;
};

const toTokenCount = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.round(parsed);
};

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

const splitToolCalls = (toolCalls?: ToolCallEntry[]) => {
  const running: ToolCallEntry[] = [];
  const errored: ToolCallEntry[] = [];
  const done: ToolCallEntry[] = [];
  const doneCounts = new Map<string, number>();

  for (const toolCall of toolCalls || []) {
    if (toolCall.status === 'running') {
      running.push(toolCall);
      continue;
    }
    if (toolCall.status === 'error') {
      errored.push(toolCall);
      continue;
    }
    done.push(toolCall);
    doneCounts.set(toolCall.toolName, (doneCounts.get(toolCall.toolName) || 0) + 1);
  }

  return {
    running,
    errored,
    done,
    doneSummary: [...doneCounts.entries()]
      .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
      .join(', '),
  };
};

const pruneThreadMap = <T,>(
  values: Record<string, T>,
  validThreadIds: Set<string>,
): Record<string, T> => {
  const entries = Object.entries(values);
  if (entries.length === 0) return values;

  const nextEntries = entries.filter(([threadId]) => validThreadIds.has(threadId));
  if (nextEntries.length === entries.length) return values;
  return Object.fromEntries(nextEntries) as Record<string, T>;
};

const DiffView = lazy(async () => {
  const module = await import('./DiffView');
  return { default: module.DiffView };
});

const TerminalView = lazy(async () => {
  const module = await import('./TerminalView');
  return { default: module.TerminalView };
});

const THREAD_TABS = ['chat', 'diff', 'terminal'] as const;

type ThreadMessageItemProps = {
  msg: ChatMessage;
  isFirstMessage: boolean;
  isActiveStreamingAssistant: boolean;
  streamingStatus: string;
  githubUser: GitHubUser | null;
  showToolOutputDetails: boolean;
  isThinkingExpanded: boolean;
  isFullThinkingExpanded: boolean;
  isToolsExpanded: boolean;
  onToggleThinking: (messageId: string) => void;
  onShowFullThinking: (messageId: string) => void;
  onToggleToolCalls: (messageId: string) => void;
};

const ThreadMessageItem = memo(({
  msg,
  isFirstMessage,
  isActiveStreamingAssistant,
  streamingStatus,
  githubUser,
  showToolOutputDetails,
  isThinkingExpanded,
  isFullThinkingExpanded,
  isToolsExpanded,
  onToggleThinking,
  onShowFullThinking,
  onToggleToolCalls,
}: ThreadMessageItemProps) => {
  const hasAssistantDetails = msg.role === 'assistant'
    && (
      Boolean(msg.toolCalls?.length)
      || Boolean(msg.thinking)
      || (isActiveStreamingAssistant && Boolean(streamingStatus))
    );
  const isLongThinking = Boolean(msg.thinking && msg.thinking.length > THINKING_PREVIEW_LIMIT);
  const thinkingSummary = useMemo(
    () => (msg.thinking ? summarizeThinking(msg.thinking) : ''),
    [msg.thinking],
  );
  const thinkingContent = useMemo(
    () => (msg.thinking ? previewThinking(msg.thinking, isFullThinkingExpanded) : ''),
    [isFullThinkingExpanded, msg.thinking],
  );
  const { running, errored, done, doneSummary } = useMemo(
    () => splitToolCalls(msg.toolCalls),
    [msg.toolCalls],
  );
  const authorName = msg.role === 'user'
    ? (githubUser?.name || githubUser?.login || 'You')
    : 'Copilot';

  return (
    <div className={cn('flex gap-3 py-3.5', !isFirstMessage && 'border-t')}>
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
          {authorName}
        </span>
        {hasAssistantDetails && (
          <div className="mb-2 space-y-1.5">
            {msg.thinking && (
              <div className="thinking-block" data-testid="thinking-block">
                <button
                  type="button"
                  className="thinking-toggle"
                  data-testid="thinking-toggle"
                  onClick={() => onToggleThinking(msg.id)}
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
                        onClick={() => onShowFullThinking(msg.id)}
                      >
                        Show more
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {isActiveStreamingAssistant && streamingStatus && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                <span className="truncate">{streamingStatus}</span>
              </div>
            )}
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="space-y-1">
                {running.map((toolCall) => (
                  <div key={toolCall.id} className="text-[11px] text-muted-foreground/80 flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                    <span className="truncate">{toolCall.toolName}</span>
                  </div>
                ))}
                {errored.map((toolCall) => (
                  <div key={toolCall.id} className="text-[11px] text-muted-foreground/80">
                    <div className="flex items-center gap-2">
                      <span className="text-destructive">✕</span>
                      <span className="truncate">{toolCall.toolName}</span>
                    </div>
                    {toolCall.error && (
                      <div className="pl-5 mt-0.5 text-destructive whitespace-pre-wrap break-words">
                        {toolCall.error}
                      </div>
                    )}
                  </div>
                ))}
                {done.length > 0 && (
                  <div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                      onClick={() => onToggleToolCalls(msg.id)}
                    >
                      <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', !isToolsExpanded && '-rotate-90')} />
                      <Check className="w-3 h-3 shrink-0 text-emerald-600" />
                      <span>{done.length} tool call{done.length !== 1 ? 's' : ''}</span>
                      {!isToolsExpanded && doneSummary && (
                        <span className="text-muted-foreground/50 truncate max-w-[200px]">{doneSummary}</span>
                      )}
                    </button>
                    {isToolsExpanded && (
                      <div className="ml-5 mt-1 space-y-0.5">
                        {done.map((toolCall) => (
                          <div key={toolCall.id} className="text-[11px] text-muted-foreground/60">
                            <div className="flex items-center gap-2">
                              <Check className="w-3 h-3 shrink-0 text-emerald-600/60" />
                              <span className="truncate">{toolCall.toolName}</span>
                            </div>
                            {showToolOutputDetails && toolCall.result && (
                              <div className="pl-5 mt-0.5 text-muted-foreground/50 whitespace-pre-wrap break-words">
                                {toolCall.result}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {msg.role === 'assistant' && msg.content ? (
          <MarkdownMessage
            content={msg.content}
            className="text-[13.5px] leading-relaxed text-foreground select-text"
          />
        ) : msg.role === 'assistant' && msg.status === 'streaming' && !msg.content ? (
          <span className="inline-flex gap-1 py-1">
            <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
            <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
            <span className="typing-dot w-1.5 h-1.5 bg-primary rounded-full" />
          </span>
        ) : (
          <div className="text-[13.5px] leading-relaxed text-foreground whitespace-pre-wrap break-words select-text">
            {msg.content}
          </div>
        )}
        {msg.status === 'error' && (
          <span className="text-destructive text-[11px] mt-1 block">Failed</span>
        )}
      </div>
    </div>
  );
});

ThreadMessageItem.displayName = 'ThreadMessageItem';

export const ThreadPanel: React.FC = () => {
  const {
    activeThreadId,
    thread,
    threadIdsKey,
    activeTab,
    setActiveTab,
    addMessage,
    appendToMessage,
    updateMessage,
    updateThread,
    appendStreamBuffers,
    addToolCall,
    updateToolCallStatus,
    addThreadTokenUsage,
    projectPath,
    selectedModel,
    setSelectedModel,
    githubUser,
    reasoningEffort,
    setReasoningEffort,
    permissionMode,
    setPermissionMode,
    mcpServers,
    showToolOutputDetails,
    availableModels,
    pendingInputInsertion,
    consumeInputInsertion,
  } = useAppStore(
    useShallow((state) => ({
      activeThreadId: state.activeThreadId,
      thread: state.activeThreadId
        ? state.threads.find((threadEntry) => threadEntry.id === state.activeThreadId) || null
        : null,
      threadIdsKey: state.threads.map((threadEntry) => threadEntry.id).join(THREAD_ID_SEPARATOR),
      activeTab: state.activeTab,
      setActiveTab: state.setActiveTab,
      addMessage: state.addMessage,
      appendToMessage: state.appendToMessage,
      updateMessage: state.updateMessage,
      updateThread: state.updateThread,
      appendStreamBuffers: state.appendStreamBuffers,
      addToolCall: state.addToolCall,
      updateToolCallStatus: state.updateToolCallStatus,
      addThreadTokenUsage: state.addThreadTokenUsage,
      projectPath: state.projectPath,
      selectedModel: state.selectedModel,
      setSelectedModel: state.setSelectedModel,
      githubUser: state.githubUser,
      reasoningEffort: state.reasoningEffort,
      setReasoningEffort: state.setReasoningEffort,
      permissionMode: state.permissionMode,
      setPermissionMode: state.setPermissionMode,
      mcpServers: state.mcpServers,
      showToolOutputDetails: state.showToolOutputDetails,
      availableModels: state.availableModels,
      pendingInputInsertion: state.pendingInputInsertion,
      consumeInputInsertion: state.consumeInputInsertion,
    })),
  );
  const [inputByThread, setInputByThread] = useState<Record<string, string>>({});
  const [pendingPermissionByThread, setPendingPermissionByThread] =
    useState<Record<string, PendingPermissionRequest>>({});
  const [pendingUserInputByThread, setPendingUserInputByThread] =
    useState<Record<string, PendingUserInputRequest>>({});
  const [userInputAnswerByThread, setUserInputAnswerByThread] = useState<Record<string, string>>({});
  const [agentStatusMap, setAgentStatusMap] = useState<Record<string, string>>({});
  const [editingTitleThreadId, setEditingTitleThreadId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [expandedThinkingByMessage, setExpandedThinkingByMessage] = useState<Record<string, boolean>>({});
  const [expandedFullThinkingByMessage, setExpandedFullThinkingByMessage] = useState<Record<string, boolean>>({});
  const [expandedToolCallsByMessage, setExpandedToolCallsByMessage] = useState<Record<string, boolean>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cancelTitleEditRef = useRef(false);
  const streamCleanupByThreadRef = useRef<Record<string, () => void>>({});
  const activeRequestIdByThreadRef = useRef<Record<string, string>>({});
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);

  const threadProjectPath = thread?.projectPath || projectPath || '';
  const isThreadRunning = thread?.status === 'running';
  const agentStatus = (activeThreadId && agentStatusMap[activeThreadId]) || '';
  const pendingPermission = activeThreadId ? pendingPermissionByThread[activeThreadId] || null : null;
  const pendingUserInput = activeThreadId ? pendingUserInputByThread[activeThreadId] || null : null;
  const userInputAnswer = activeThreadId ? userInputAnswerByThread[activeThreadId] || '' : '';
  const input = activeThreadId ? inputByThread[activeThreadId] || '' : '';
  const isEditingTitle = thread ? editingTitleThreadId === thread.id : false;
  const currentModel = useMemo(
    () => availableModels.find((model) => model.id === selectedModel),
    [availableModels, selectedModel],
  );
  const supportedReasoningLevels = useMemo(() => {
    const supported = currentModel?.supportedReasoningEfforts;
    return (['low', 'medium', 'high', 'xhigh'] as const).filter(
      (level) => !supported || supported.length === 0 || supported.includes(level),
    );
  }, [currentModel]);
  const lastMessageId = thread?.messages[thread.messages.length - 1]?.id || null;
  const showJumpToLatest = activeTab === 'chat' && !isPinnedToBottom && (thread?.messages.length || 0) > 0;

  const updateInputDraft = useCallback((threadId: string, updater: (current: string) => string) => {
    setInputByThread((prev) => {
      const current = prev[threadId] || '';
      const next = updater(current);
      if (next === current) return prev;
      if (next.length === 0) {
        const { [threadId]: _ignored, ...rest } = prev;
        return rest;
      }
      return { ...prev, [threadId]: next };
    });
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    if (force) setIsPinnedToBottom(true);
  }, []);

  const isNearBottom = useCallback((element: HTMLDivElement) => (
    element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD
  ), []);

  const handleChatScroll = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) return;
    const nextPinnedState = isNearBottom(element);
    setIsPinnedToBottom((prev) => (prev === nextPinnedState ? prev : nextPinnedState));
  }, [isNearBottom]);

  // Scroll on new messages and during streaming content growth.
  useEffect(() => {
    if (!thread || activeTab !== 'chat' || !isPinnedToBottom) return;
    scrollToBottom();
  }, [activeTab, agentStatus, isPinnedToBottom, scrollToBottom, thread?.messages]);

  useEffect(() => () => {
    Object.values(streamCleanupByThreadRef.current).forEach((cleanup) => cleanup());
    streamCleanupByThreadRef.current = {};
    activeRequestIdByThreadRef.current = {};
  }, []);

  useEffect(() => {
    setIsPinnedToBottom(true);
  }, [activeThreadId]);

  useEffect(() => {
    if (!editingTitleThreadId || editingTitleThreadId === activeThreadId) return;
    setEditingTitleThreadId(null);
    setTitleDraft('');
  }, [activeThreadId, editingTitleThreadId]);

  useEffect(() => {
    const validThreadIds = new Set(threadIdsKey.split(THREAD_ID_SEPARATOR).filter(Boolean));
    if (editingTitleThreadId && !validThreadIds.has(editingTitleThreadId)) {
      setEditingTitleThreadId(null);
      setTitleDraft('');
    }

    setInputByThread((prev) => pruneThreadMap(prev, validThreadIds));
    setPendingPermissionByThread((prev) => pruneThreadMap(prev, validThreadIds));
    setPendingUserInputByThread((prev) => pruneThreadMap(prev, validThreadIds));
    setUserInputAnswerByThread((prev) => pruneThreadMap(prev, validThreadIds));
    setAgentStatusMap((prev) => pruneThreadMap(prev, validThreadIds));

    const staleThreadIds = Object.keys(streamCleanupByThreadRef.current)
      .filter((threadId) => !validThreadIds.has(threadId));
    for (const staleThreadId of staleThreadIds) {
      streamCleanupByThreadRef.current[staleThreadId]?.();
    }
    activeRequestIdByThreadRef.current = pruneThreadMap(
      activeRequestIdByThreadRef.current,
      validThreadIds,
    );
  }, [editingTitleThreadId, threadIdsKey]);

  // Consume pending chat input insertions from sidebar skill/agent clicks.
  useEffect(() => {
    if (pendingInputInsertion !== null && activeThreadId) {
      const text = consumeInputInsertion();
      if (text) {
        updateInputDraft(activeThreadId, (current) => current + text);
        inputRef.current?.focus();
      }
    }
  }, [activeThreadId, consumeInputInsertion, pendingInputInsertion]);

  // Listen for permission requests from the agent backend.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const unsub = api.on('agent:permission-request', (threadId: string, data: unknown) => {
      if (!isPendingPermissionRequest(data)) return;
      setPendingPermissionByThread((prev) => ({ ...prev, [threadId]: data }));
    });
    return unsub;
  }, []);

  const respondToPermission = useCallback((approved: boolean) => {
    if (!activeThreadId) return;
    const pending = pendingPermissionByThread[activeThreadId];
    if (!pending) return;
    window.electronAPI?.sendReply(pending.replyChannel, approved);
    setPendingPermissionByThread((prev) => {
      const { [activeThreadId]: _ignored, ...rest } = prev;
      return rest;
    });
  }, [activeThreadId, pendingPermissionByThread]);

  // Listen for user-input requests (ask_user tool) from the agent backend.
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    const unsub = api.on('agent:user-input-request', (threadId: string, data: unknown) => {
      if (!isPendingUserInputRequest(data)) return;
      setPendingUserInputByThread((prev) => ({ ...prev, [threadId]: data }));
      setUserInputAnswerByThread((prev) => ({ ...prev, [threadId]: '' }));
    });
    return unsub;
  }, []);

  const respondToUserInput = useCallback((answer: string) => {
    if (!activeThreadId) return;
    const pending = pendingUserInputByThread[activeThreadId];
    if (!pending) return;
    window.electronAPI?.sendReply(pending.replyChannel, answer);
    setPendingUserInputByThread((prev) => {
      const { [activeThreadId]: _ignored, ...rest } = prev;
      return rest;
    });
    setUserInputAnswerByThread((prev) => {
      const { [activeThreadId]: _ignored, ...rest } = prev;
      return rest;
    });
  }, [activeThreadId, pendingUserInputByThread]);

  const toggleThinking = useCallback((messageId: string) => {
    setExpandedThinkingByMessage((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  }, []);

  const showFullThinking = useCallback((messageId: string) => {
    setExpandedFullThinkingByMessage((prev) => ({ ...prev, [messageId]: true }));
  }, []);

  const toggleToolCalls = useCallback((messageId: string) => {
    setExpandedToolCallsByMessage((prev) => ({ ...prev, [messageId]: !prev[messageId] }));
  }, []);

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    tab: (typeof THREAD_TABS)[number],
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const currentIndex = THREAD_TABS.indexOf(tab);
    const nextIndex = event.key === 'ArrowRight'
      ? (currentIndex + 1) % THREAD_TABS.length
      : (currentIndex - 1 + THREAD_TABS.length) % THREAD_TABS.length;
    setActiveTab(THREAD_TABS[nextIndex]);
  };

  const tabPanelFallback = (
    <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
      Loading panel…
    </div>
  );

  const handleCancel = () => {
    if (!thread || !activeThreadId) return;
    window.electronAPI?.send('agent:cancel', activeThreadId);
  };

  const handleSend = () => {
    if (!thread || !activeThreadId || thread.status === 'running') return;
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

    // Auto-title from first user message
    if (thread.title === 'New thread') {
      const autoTitle = trimmedInput.length > 50
        ? trimmedInput.slice(0, 47) + '...'
        : trimmedInput;
      updateThread(threadId, { title: autoTitle });
    }

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
    updateInputDraft(threadId, () => '');

    if (window.electronAPI) {
      const api = window.electronAPI;
      activeRequestIdByThreadRef.current[threadId] = requestId;
      let chunkBuffer = '';
      let thinkingBuffer = '';
      let rafId: number | null = null;
      let cleanedUp = false;
      let unsub: (() => void) | undefined;
      const runningToolCallIds: string[] = [];

      const flushChunks = () => {
        rafId = null;
        const pendingContent = chunkBuffer;
        const pendingThinking = thinkingBuffer;
        chunkBuffer = '';
        thinkingBuffer = '';
        if (pendingContent || pendingThinking) {
          appendStreamBuffers(
            threadId,
            assistantMsgId,
            pendingContent || undefined,
            pendingThinking || undefined,
          );
        }
      };

      const cleanup = (flushPending = false) => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (rafId !== null) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (flushPending && (chunkBuffer || thinkingBuffer)) {
          appendStreamBuffers(
            threadId,
            assistantMsgId,
            chunkBuffer || undefined,
            thinkingBuffer || undefined,
          );
          chunkBuffer = '';
          thinkingBuffer = '';
        }
        unsub?.();
        if (streamCleanupByThreadRef.current[threadId] === cleanup) {
          delete streamCleanupByThreadRef.current[threadId];
        }
        if (activeRequestIdByThreadRef.current[threadId] === requestId) {
          delete activeRequestIdByThreadRef.current[threadId];
        }
      };

      const isCurrentPayload = (payload: AgentStreamPayload) =>
        (!payload.requestId || payload.requestId === requestId)
        && activeRequestIdByThreadRef.current[threadId] === requestId;

      const processPayload = (payload: AgentStreamPayload) => {
        if (payload.type === 'turn_reset') {
          if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
          }
          chunkBuffer = '';
          thinkingBuffer = '';
          updateMessage(threadId, assistantMsgId, { content: '' });
        } else if (payload.type === 'chunk') {
          const content = typeof payload.content === 'string' ? payload.content : '';
          if (!content) return;
          chunkBuffer += content;
          if (rafId === null) {
            rafId = requestAnimationFrame(flushChunks);
          }
        } else if (payload.type === 'thinking') {
          if (typeof payload.content === 'string' && payload.content.length > 0) {
            thinkingBuffer += payload.content;
            if (rafId === null) {
              rafId = requestAnimationFrame(flushChunks);
            }
          }
        } else if (payload.type === 'usage') {
          const inputTokens = toTokenCount(payload.inputTokens);
          const outputTokens = toTokenCount(payload.outputTokens);
          const cacheReadTokens = toTokenCount(payload.cacheReadTokens);
          const cacheWriteTokens = toTokenCount(payload.cacheWriteTokens);
          const totalTokens = toTokenCount(payload.totalTokens)
            || (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens);

          if (totalTokens > 0 || inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0 || cacheWriteTokens > 0) {
            addThreadTokenUsage(threadId, {
              inputTokens,
              outputTokens,
              cacheReadTokens,
              cacheWriteTokens,
              totalTokens,
            });
          }
        } else if (payload.type === 'tool_start') {
          const toolCallId = typeof payload.toolCallId === 'string' && payload.toolCallId.length > 0
            ? payload.toolCallId
            : `tool-${crypto.randomUUID()}`;
          const toolName = typeof payload.toolName === 'string' && payload.toolName.length > 0
            ? payload.toolName
            : 'tool';
          if (!runningToolCallIds.includes(toolCallId)) {
            runningToolCallIds.push(toolCallId);
          }
          addToolCall(threadId, assistantMsgId, {
            id: toolCallId,
            toolName,
            status: 'running',
          });
          setAgentStatusMap((prev) => ({ ...prev, [threadId]: `Running ${toolName}` }));
        } else if (payload.type === 'tool_end') {
          const resolvedToolCallId = (() => {
            if (typeof payload.toolCallId === 'string' && payload.toolCallId.length > 0) {
              const index = runningToolCallIds.indexOf(payload.toolCallId);
              if (index >= 0) runningToolCallIds.splice(index, 1);
              return payload.toolCallId;
            }
            const nextRunningToolCallId = runningToolCallIds.shift();
            if (nextRunningToolCallId) return nextRunningToolCallId;
            const message = useAppStore
              .getState()
              .threads
              .find((t) => t.id === threadId)
              ?.messages
              .find((m) => m.id === assistantMsgId);
            const toolCalls = message?.toolCalls || [];
            for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
              if (toolCalls[i].status === 'running') return toolCalls[i].id;
            }
            return '';
          })();

          if (resolvedToolCallId) {
            updateToolCallStatus(
              threadId,
              assistantMsgId,
              resolvedToolCallId,
              payload.success === false || typeof payload.error === 'string' ? 'error' : 'done',
              {
                result: typeof payload.result === 'string' ? payload.result : undefined,
                error: typeof payload.error === 'string' ? payload.error : undefined,
              },
            );
          }
          setAgentStatusMap((prev) => ({ ...prev, [threadId]: '' }));
        } else if (payload.type === 'status') {
          setAgentStatusMap((prev) => ({
            ...prev,
            [threadId]: typeof payload.status === 'string' ? payload.status : '',
          }));
        } else if (payload.type === 'done') {
          cleanup(true);
          if (typeof payload.content === 'string' && payload.content.length > 0) {
            updateMessage(threadId, assistantMsgId, { content: payload.content });
          }
          updateMessage(threadId, assistantMsgId, { status: 'done' });
          updateThread(threadId, { status: 'completed' });
          setAgentStatusMap((prev) => ({ ...prev, [threadId]: '' }));
        } else if (payload.type === 'error') {
          cleanup(true);
          updateMessage(threadId, assistantMsgId, {
            status: 'error',
            content: formatAgentErrorContent(payload.content),
          });
          updateThread(threadId, { status: 'error' });
          setAgentStatusMap((prev) => ({ ...prev, [threadId]: '' }));
        }
      };

      const handler = (streamThreadId: string, data: unknown) => {
        const payload = toAgentStreamPayload(data);
        if (!payload) return;
        if (streamThreadId !== threadId) return;
        if (!isCurrentPayload(payload)) return;

        if (payload.type === 'batch') {
          const events = Array.isArray(payload.events) ? payload.events : [];
          for (const rawEvent of events) {
            const nestedPayload = toAgentStreamPayload(rawEvent);
            if (!nestedPayload || !isCurrentPayload(nestedPayload)) continue;
            processPayload(nestedPayload);
          }
          return;
        }

        processPayload(payload);
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
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!thread) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" data-testid="thread-panel">
      {/* Header — Codex style */}
      <div className="flex items-center justify-between gap-3 px-8 pt-7 pb-4 shrink-0 flex-wrap">
        {isEditingTitle ? (
          <input
            className="text-xl font-semibold text-foreground bg-transparent outline-none border-b-2 border-primary min-w-[120px]"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => {
              const shouldCancel = cancelTitleEditRef.current;
              cancelTitleEditRef.current = false;
              if (!shouldCancel && titleDraft.trim()) {
                updateThread(thread.id, { title: titleDraft.trim() });
              }
              setEditingTitleThreadId(null);
              setTitleDraft('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                cancelTitleEditRef.current = true;
                (e.target as HTMLInputElement).blur();
              }
            }}
            autoFocus
          />
        ) : (
          <h2
            className="text-xl font-semibold text-foreground cursor-pointer hover:text-primary/80 transition-colors"
            onDoubleClick={() => { setEditingTitleThreadId(thread.id); setTitleDraft(thread.title); }}
            title="Double-click to rename"
          >{thread.title}</h2>
        )}
        <div className="flex items-center gap-2 min-w-0">
          {thread.tokenUsage && thread.tokenUsage.totalTokens > 0 && (
            <TokenCounter usage={thread.tokenUsage} />
          )}
          <div
            className="flex gap-0.5 bg-secondary/80 rounded-lg p-1 overflow-x-auto border border-border/70"
            role="tablist"
            aria-label="Thread view tabs"
          >
            <button
              id="thread-tab-chat"
              data-testid="tab-chat"
              aria-label="Chat tab"
              role="tab"
              aria-selected={activeTab === 'chat'}
              aria-controls="thread-tabpanel-chat"
              tabIndex={activeTab === 'chat' ? 0 : -1}
              className={cn('inline-flex items-center gap-1.5 px-3 h-7 text-xs font-medium rounded-md transition-all',
                activeTab === 'chat' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setActiveTab('chat')}
              onKeyDown={(event) => handleTabKeyDown(event, 'chat')}
            >
              <MessageSquare className="w-3.5 h-3.5" /> Chat
            </button>
            <button
              id="thread-tab-diff"
              data-testid="tab-diff"
              aria-label="Diff tab"
              role="tab"
              aria-selected={activeTab === 'diff'}
              aria-controls="thread-tabpanel-diff"
              tabIndex={activeTab === 'diff' ? 0 : -1}
              className={cn('inline-flex items-center gap-1.5 px-3 h-7 text-xs font-medium rounded-md transition-all',
                activeTab === 'diff' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setActiveTab('diff')}
              onKeyDown={(event) => handleTabKeyDown(event, 'diff')}
            >
              <GitCompare className="w-3.5 h-3.5" /> Diff
            </button>
            <button
              id="thread-tab-terminal"
              data-testid="tab-terminal"
              aria-label="Terminal tab"
              role="tab"
              aria-selected={activeTab === 'terminal'}
              aria-controls="thread-tabpanel-terminal"
              tabIndex={activeTab === 'terminal' ? 0 : -1}
              className={cn('inline-flex items-center gap-1.5 px-3 h-7 text-xs font-medium rounded-md transition-all',
                activeTab === 'terminal' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              onClick={() => setActiveTab('terminal')}
              onKeyDown={(event) => handleTabKeyDown(event, 'terminal')}
            >
              <TerminalSquare className="w-3.5 h-3.5" /> Terminal
            </button>
          </div>
        </div>
      </div>

      {/* Chat Tab — kept mounted to preserve scroll position */}
      <div
        id="thread-tabpanel-chat"
        role="tabpanel"
        aria-labelledby="thread-tab-chat"
        aria-hidden={activeTab !== 'chat'}
        className={cn('flex-1 flex flex-col min-h-0 overflow-hidden', activeTab !== 'chat' && 'hidden')}
      >
          <div
            ref={scrollContainerRef}
            data-testid="thread-scroll-container"
            className="flex-1 min-h-0 overflow-y-auto"
            aria-live="polite"
            aria-busy={isThreadRunning}
            onScroll={handleChatScroll}
          >
            <div className="px-8 py-4">
              {thread.messages.length === 0 && (
                <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 pb-20 rounded-xl border border-dashed border-border/70 bg-secondary/15">
                  <LoomIcon className="w-12 h-12 text-muted-foreground opacity-40" strokeWidth={1} />
                  <p className="text-muted-foreground text-[15px]">Start a conversation to work on this task</p>
                  <p className="text-muted-foreground/60 text-xs">Copilot can write code, run commands, review diffs, and more</p>
                </div>
              )}
              {thread.messages.map((msg, index) => (
                <ThreadMessageItem
                  key={msg.id}
                  msg={msg}
                  isFirstMessage={index === 0}
                  isActiveStreamingAssistant={
                    msg.role === 'assistant'
                    && msg.status === 'streaming'
                    && msg.id === lastMessageId
                  }
                  streamingStatus={msg.id === lastMessageId ? agentStatus : ''}
                  githubUser={githubUser}
                  showToolOutputDetails={showToolOutputDetails}
                  isThinkingExpanded={Boolean(expandedThinkingByMessage[msg.id])}
                  isFullThinkingExpanded={Boolean(expandedFullThinkingByMessage[msg.id])}
                  isToolsExpanded={Boolean(expandedToolCallsByMessage[msg.id])}
                  onToggleThinking={toggleThinking}
                  onShowFullThinking={showFullThinking}
                  onToggleToolCalls={toggleToolCalls}
                />
              ))}
            </div>
          </div>

          {/* Permission approval banner */}
          {pendingPermission && (
            <div className="mx-8 mb-1 p-3 bg-accent border border-border rounded-lg flex items-start gap-3">
              <span className="text-lg mt-0.5">🔐</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  Allow <span className="font-mono">{pendingPermission.kind}</span> access?
                </p>
                {(() => {
                  const { kind: _kind, replyChannel: _replyChannel, ...rest } = pendingPermission;
                  const details = [rest.toolName, rest.command, rest.path, rest.url]
                    .find((value): value is string => typeof value === 'string' && value.length > 0);
                  return details ? (
                    <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">{details}</p>
                  ) : null;
                })()}
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="outline"
                  className="h-7 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
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
            <div className="mx-8 mb-1 p-3 bg-accent border border-border rounded-lg space-y-2">
              <div className="flex items-start gap-2">
                <span className="text-primary text-lg">💬</span>
                <p className="text-[13px] font-medium text-foreground">{pendingUserInput.question}</p>
              </div>
              {pendingUserInput.choices && pendingUserInput.choices.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-7">
                  {pendingUserInput.choices.map((choice: string, i: number) => (
                    <Button key={i} size="sm" variant="outline"
                      className="h-7 text-xs"
                      onClick={() => respondToUserInput(choice)}
                    >{choice}</Button>
                  ))}
                </div>
              )}
              {(pendingUserInput.allowFreeform !== false || !pendingUserInput.choices?.length) && (
                <div className="flex gap-1.5 pl-7">
                  <input
                    type="text"
                    className="flex-1 px-2.5 py-1.5 text-xs bg-card border border-border rounded-md outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground"
                    placeholder="Type your answer..."
                    value={userInputAnswer}
                    onChange={(e) => {
                      if (!activeThreadId) return;
                      setUserInputAnswerByThread((prev) => ({ ...prev, [activeThreadId]: e.target.value }));
                    }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && userInputAnswer.trim()) respondToUserInput(userInputAnswer.trim()); }}
                    autoFocus
                  />
                  <Button size="sm"
                    className="h-7 text-xs"
                    disabled={!userInputAnswer.trim()}
                    onClick={() => respondToUserInput(userInputAnswer.trim())}
                  >Send</Button>
                </div>
              )}
            </div>
          )}

          {showJumpToLatest && (
            <div className="px-8 pb-2 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="thread-jump-to-latest"
                className="h-8 rounded-full border-border/80 bg-background/95 text-xs shadow-sm"
                onClick={() => scrollToBottom(true)}
              >
                <ChevronDown className="w-3.5 h-3.5" />
                Jump to latest
              </Button>
            </div>
          )}

          {/* Input */}
          <div className="px-8 pb-6 pt-3">
            <div className="flex items-center bg-secondary/60 border border-border/80 rounded-xl p-1 transition-all">
              <textarea
                data-testid="thread-input"
                data-loom-chat-input="true"
                ref={inputRef}
                aria-label="Chat message input"
                className="flex-1 px-3.5 py-2 bg-transparent border-none text-sm font-sans resize-none outline-none max-h-[120px] leading-relaxed text-foreground placeholder:text-muted-foreground"
                placeholder="Ask Copilot to work on something..."
                value={input}
                disabled={isThreadRunning}
                onChange={(e) => {
                  if (!activeThreadId) return;
                  updateInputDraft(activeThreadId, () => e.target.value);
                }}
                onKeyDown={handleKeyDown}
                rows={1}
              />
              {isThreadRunning ? (
                <Button
                  data-testid="thread-stop"
                  size="icon"
                  variant="destructive"
                  className="h-9 w-9 rounded-[10px] shrink-0 self-end"
                  aria-label="Stop response"
                  onClick={handleCancel}
                >
                  <Square className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  data-testid="thread-send"
                  size="icon"
                  className="h-9 w-9 rounded-[10px] shrink-0 self-end"
                  aria-label="Send message"
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
                {supportedReasoningLevels.length > 0 && (
                  <div className="flex items-center gap-0.5 bg-secondary/50 rounded-md p-0.5">
                    {supportedReasoningLevels.map((level) => (
                      <button
                        key={level}
                        onClick={() => setReasoningEffort(level)}
                        aria-label={`Set reasoning effort to ${level}`}
                        aria-pressed={reasoningEffort === level}
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
                )}
                {/* Permission mode */}
                <div className="flex items-center gap-0.5 bg-secondary/50 rounded-md p-0.5">
                  {(['auto', 'ask', 'deny'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setPermissionMode(mode)}
                      aria-label={`Permission mode ${mode}`}
                      aria-pressed={permissionMode === mode}
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

      {/* Diff Tab */}
      {activeTab === 'diff' && (
        <div id="thread-tabpanel-diff" role="tabpanel" aria-labelledby="thread-tab-diff" className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <Suspense fallback={tabPanelFallback}>
            <DiffView projectPath={threadProjectPath} />
          </Suspense>
        </div>
      )}

      {/* Terminal Tab */}
      {activeTab === 'terminal' && (
        <div id="thread-tabpanel-terminal" role="tabpanel" aria-labelledby="thread-tab-terminal" className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <Suspense fallback={tabPanelFallback}>
            <TerminalView threadId={thread.id} projectPath={threadProjectPath} />
          </Suspense>
        </div>
      )}
    </div>
  );
};
