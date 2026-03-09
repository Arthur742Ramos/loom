import React, {
  lazy, Suspense, useState, useRef, useEffect, useMemo, useCallback, memo, useLayoutEffect,
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
  Clock3, Copy, CornerUpLeft, Sparkles, ShieldAlert,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { MarkdownMessage } from './MarkdownMessage';
import { LoomIcon } from './LoomIcon';
import { ModelPicker } from './ModelPicker';
import { TokenCounter } from './TokenCounter';

const THINKING_SUMMARY_LIMIT = 60;
const THINKING_PREVIEW_LIMIT = 500;
const THREAD_ID_SEPARATOR = '\u0000';
const TOOL_RESULT_KEY_SEPARATOR = '\u0001';
const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;
const TOOL_RESULT_PREVIEW_LIMIT = 160;
const COPY_RESET_DELAY_MS = 1600;
const MESSAGE_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

type PromptSuggestion = {
  label: string;
  prompt: string;
};

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

const formatMessageTime = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) return '';
  return MESSAGE_TIME_FORMATTER.format(new Date(timestamp));
};

const summarizeToolResult = (result: string): string => {
  const normalized = result.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'No output captured';
  return normalized.length > TOOL_RESULT_PREVIEW_LIMIT
    ? `${normalized.slice(0, TOOL_RESULT_PREVIEW_LIMIT)}…`
    : normalized;
};

const shouldShowToolResultToggle = (result?: string): boolean => (
  Boolean(result && (result.length > TOOL_RESULT_PREVIEW_LIMIT || result.includes('\n')))
);

const getToolResultKey = (messageId: string, toolCallId: string): string =>
  `${messageId}${TOOL_RESULT_KEY_SEPARATOR}${toolCallId}`;

const getPromptSuggestions = (projectName?: string | null): PromptSuggestion[] => {
  const label = projectName || 'this project';
  return [
    {
      label: 'Plan the work',
      prompt: `Review ${label} and propose the best implementation plan before making changes.`,
    },
    {
      label: 'Review the codebase',
      prompt: `Inspect ${label} and summarize the most important code paths I should understand first.`,
    },
    {
      label: 'Polish the UX',
      prompt: `Audit the current chat experience in ${label} and improve the highest-impact UI and UX details.`,
    },
  ];
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
  isCopied: boolean;
  isToolResultExpanded: (messageId: string, toolCallId: string) => boolean;
  onToggleThinking: (messageId: string) => void;
  onShowFullThinking: (messageId: string) => void;
  onToggleToolCalls: (messageId: string, isCurrentlyExpanded: boolean) => void;
  onToggleToolResult: (messageId: string, toolCallId: string) => void;
  onCopyMessage: (messageId: string, content: string) => void;
  onReuseMessage: (content: string) => void;
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
  isCopied,
  isToolResultExpanded,
  onToggleThinking,
  onShowFullThinking,
  onToggleToolCalls,
  onToggleToolResult,
  onCopyMessage,
  onReuseMessage,
}: ThreadMessageItemProps) => {
  const isUserMessage = msg.role === 'user';
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
  const messageTime = useMemo(() => formatMessageTime(msg.timestamp), [msg.timestamp]);
  const assistantStateLabel = msg.role === 'assistant'
    ? msg.status === 'error'
      ? 'Needs attention'
      : msg.status === 'streaming'
        ? 'Working'
        : 'Ready'
    : '';
  const clipboardSupported = typeof navigator !== 'undefined' && Boolean(navigator.clipboard?.writeText);

  return (
    <div className={cn('py-4', !isFirstMessage && 'border-t border-border/40')}>
      <div className={cn('flex gap-3', isUserMessage ? 'justify-end' : 'justify-start')}>
        {!isUserMessage && (
          <Avatar className="mt-1 h-8 w-8 shrink-0 border border-border/70 bg-card/80 shadow-sm">
            <AvatarFallback className="bg-primary/10 text-primary text-xs">
              <LoomIcon className="h-3.5 w-3.5" />
            </AvatarFallback>
          </Avatar>
        )}
        <div className={cn(
          'min-w-0 flex flex-col gap-2',
          isUserMessage ? 'max-w-[min(100%,42rem)] items-end' : 'max-w-[min(100%,50rem)]',
        )}>
          <div className={cn(
            'flex w-full items-center justify-between gap-3 text-[11px] text-muted-foreground',
            isUserMessage && 'flex-row-reverse',
          )}>
            <div className={cn('flex items-center gap-2 min-w-0', isUserMessage && 'flex-row-reverse')}>
              <span className="font-semibold text-foreground/85">{authorName}</span>
              {messageTime && (
                <>
                  <span className="h-1 w-1 rounded-full bg-border" />
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3 w-3" />
                    {messageTime}
                  </span>
                </>
              )}
              {assistantStateLabel && (
                <span className={cn(
                  'thread-message-badge',
                  msg.status === 'error'
                    ? 'thread-message-badge-error'
                    : msg.status === 'streaming'
                      ? 'thread-message-badge-active'
                      : 'thread-message-badge-success',
                )}
                >
                  {assistantStateLabel}
                </span>
              )}
            </div>
            <div className={cn('flex items-center gap-1.5', isUserMessage && 'flex-row-reverse')}>
              {isUserMessage ? (
                <button
                  type="button"
                  className="thread-message-action"
                  onClick={() => onReuseMessage(msg.content)}
                >
                  <CornerUpLeft className="h-3 w-3" />
                  Reuse prompt
                </button>
              ) : clipboardSupported && msg.content ? (
                <button
                  type="button"
                  className="thread-message-action"
                  onClick={() => onCopyMessage(msg.id, msg.content)}
                >
                  <Copy className="h-3 w-3" />
                  {isCopied ? 'Copied' : 'Copy answer'}
                </button>
              ) : null}
            </div>
          </div>
          <div className={cn(
            'thread-message-surface',
            isUserMessage ? 'thread-message-user' : 'thread-message-assistant',
          )}
          >
            {hasAssistantDetails && (
              <div className="mb-3 space-y-2">
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
                          'h-3 w-3 shrink-0 transition-transform',
                          isThinkingExpanded ? 'rotate-0' : '-rotate-90',
                        )}
                      />
                      <span className="thinking-toggle-label">Reasoning trace</span>
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
                  <div className="thread-activity-pill">
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    <span>{streamingStatus}</span>
                  </div>
                )}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="space-y-2">
                    {running.map((toolCall) => (
                      <div key={toolCall.id} className="tool-call-card tool-call-card-running">
                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="tool-call-name">{toolCall.toolName}</span>
                            <span className="tool-call-pill">Running</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {errored.map((toolCall) => (
                      <div key={toolCall.id} className="tool-call-card tool-call-card-error">
                        <span className="text-destructive text-sm leading-none">✕</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="tool-call-name">{toolCall.toolName}</span>
                            <span className="tool-call-pill tool-call-pill-error">Failed</span>
                          </div>
                          {toolCall.error && (
                            <div className="tool-call-result mt-2 text-destructive">
                              {toolCall.error}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {done.length > 0 && (
                      <div>
                        <button
                          type="button"
                          className="tool-call-summary"
                          onClick={() => onToggleToolCalls(msg.id, isToolsExpanded)}
                        >
                          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform', !isToolsExpanded && '-rotate-90')} />
                          <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <span>{done.length} tool call{done.length !== 1 ? 's' : ''}</span>
                          {!isToolsExpanded && doneSummary && (
                            <span className="text-muted-foreground/60 truncate max-w-[250px]">{doneSummary}</span>
                          )}
                        </button>
                        {isToolsExpanded && (
                          <div className="mt-2 space-y-2">
                            {done.map((toolCall) => {
                              const resultExpanded = showToolOutputDetails
                                || isToolResultExpanded(msg.id, toolCall.id);
                              const toolResultPreview = toolCall.result
                                ? summarizeToolResult(toolCall.result)
                                : '';
                              const canToggleResult = shouldShowToolResultToggle(toolCall.result);

                              return (
                                <div key={toolCall.id} className="tool-call-card">
                                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="tool-call-name">{toolCall.toolName}</span>
                                      <span className="tool-call-pill tool-call-pill-success">Completed</span>
                                      {canToggleResult && !showToolOutputDetails && (
                                        <button
                                          type="button"
                                          className="thread-message-action ml-auto"
                                          onClick={() => onToggleToolResult(msg.id, toolCall.id)}
                                        >
                                          {resultExpanded ? 'Hide output' : 'Show output'}
                                        </button>
                                      )}
                                    </div>
                                    {toolCall.result && !resultExpanded && (
                                      <div className="tool-call-preview">{toolResultPreview}</div>
                                    )}
                                    {toolCall.result && resultExpanded && (
                                      <div className="tool-call-result mt-2">
                                        {toolCall.result}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
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
              <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                <span className="inline-flex gap-1">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-primary" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-primary" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
                <span>Copilot is composing a response…</span>
              </div>
            ) : (
              <div className={cn(
                'text-[13.5px] leading-relaxed whitespace-pre-wrap break-words select-text',
                isUserMessage ? 'text-primary-foreground' : 'text-foreground',
              )}
              >
                {msg.content}
              </div>
            )}
            {msg.status === 'error' && (
              <span className="mt-2 block text-[11px] text-destructive">The last response failed.</span>
            )}
          </div>
        </div>
        {isUserMessage && (
          <Avatar className="mt-1 h-8 w-8 shrink-0 border border-primary/20 bg-primary/10 shadow-sm">
            {githubUser?.avatar_url ? (
              <AvatarImage src={githubUser.avatar_url} alt={githubUser.login} />
            ) : null}
            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
              {githubUser?.login?.[0]?.toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
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
  const [expandedToolResultsByKey, setExpandedToolResultsByKey] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cancelTitleEditRef = useRef(false);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const streamCleanupByThreadRef = useRef<Record<string, () => void>>({});
  const activeRequestIdByThreadRef = useRef<Record<string, string>>({});
  const scrollStateByThreadRef = useRef<Record<string, { top: number; pinned: boolean }>>({});
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
  const promptSuggestions = useMemo(
    () => getPromptSuggestions(thread?.projectName),
    [thread?.projectName],
  );
  const lastMessageId = thread?.messages[thread.messages.length - 1]?.id || null;
  const showJumpToLatest = activeTab === 'chat' && !isPinnedToBottom && (thread?.messages.length || 0) > 0;
  const hasActiveDraft = input.trim().length > 0;
  const otherDraftCount = useMemo(
    () => Object.entries(inputByThread)
      .filter(([threadId, value]) => threadId !== activeThreadId && value.trim().length > 0)
      .length,
    [activeThreadId, inputByThread],
  );
  const messageCountLabel = useMemo(() => {
    const messageCount = thread?.messages.length || 0;
    return `${messageCount} message${messageCount === 1 ? '' : 's'}`;
  }, [thread?.messages.length]);
  const threadModeLabel = thread?.mode === 'worktree' ? 'Worktree context' : 'In-repo context';

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

  const resizeComposer = useCallback(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = '0px';
    const nextHeight = Math.min(element.scrollHeight, 160);
    element.style.height = `${Math.max(nextHeight, 44)}px`;
    element.style.overflowY = element.scrollHeight > nextHeight ? 'auto' : 'hidden';
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    if (activeThreadId) {
      scrollStateByThreadRef.current[activeThreadId] = {
        top: el.scrollHeight,
        pinned: true,
      };
    }
    if (force) setIsPinnedToBottom(true);
  }, [activeThreadId]);

  const isNearBottom = useCallback((element: HTMLDivElement) => (
    element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD
  ), []);

  const handleChatScroll = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element || !activeThreadId) return;
    const nextPinnedState = isNearBottom(element);
    scrollStateByThreadRef.current[activeThreadId] = {
      top: element.scrollTop,
      pinned: nextPinnedState,
    };
    setIsPinnedToBottom((prev) => (prev === nextPinnedState ? prev : nextPinnedState));
  }, [activeThreadId, isNearBottom]);

  const isToolCallsExpanded = useCallback((message: ChatMessage) => {
    if (Object.prototype.hasOwnProperty.call(expandedToolCallsByMessage, message.id)) {
      return Boolean(expandedToolCallsByMessage[message.id]);
    }
    const completedCount = message.toolCalls?.filter((toolCall) => toolCall.status === 'done').length || 0;
    return completedCount > 0 && completedCount <= 2;
  }, [expandedToolCallsByMessage]);

  const isToolResultExpanded = useCallback((messageId: string, toolCallId: string) => (
    Boolean(expandedToolResultsByKey[getToolResultKey(messageId, toolCallId)])
  ), [expandedToolResultsByKey]);

  // Scroll on new messages and during streaming content growth.
  useEffect(() => {
    if (!thread || activeTab !== 'chat') return;
    const effectivePinnedState = activeThreadId
      ? scrollStateByThreadRef.current[activeThreadId]?.pinned ?? isPinnedToBottom
      : isPinnedToBottom;
    if (!effectivePinnedState) return;
    scrollToBottom();
  }, [activeTab, activeThreadId, agentStatus, isPinnedToBottom, scrollToBottom, thread?.messages]);

  useLayoutEffect(() => {
    if (activeTab !== 'chat' || !activeThreadId) return;
    resizeComposer();
    const element = scrollContainerRef.current;
    if (!element) return;
    const savedState = scrollStateByThreadRef.current[activeThreadId];
    if (!savedState) {
      setIsPinnedToBottom(true);
      return;
    }
    setIsPinnedToBottom(savedState.pinned);
    element.scrollTop = savedState.pinned ? element.scrollHeight : savedState.top;
  }, [activeTab, activeThreadId, resizeComposer, thread?.messages.length]);

  useLayoutEffect(() => {
    resizeComposer();
  }, [activeThreadId, input, resizeComposer]);

  useEffect(() => () => {
    Object.values(streamCleanupByThreadRef.current).forEach((cleanup) => cleanup());
    streamCleanupByThreadRef.current = {};
    activeRequestIdByThreadRef.current = {};
    if (copyResetTimeoutRef.current !== null) {
      window.clearTimeout(copyResetTimeoutRef.current);
    }
  }, []);

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
    scrollStateByThreadRef.current = pruneThreadMap(scrollStateByThreadRef.current, validThreadIds);
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

  const toggleToolCalls = useCallback((messageId: string, isCurrentlyExpanded: boolean) => {
    setExpandedToolCallsByMessage((prev) => ({ ...prev, [messageId]: !isCurrentlyExpanded }));
  }, []);

  const toggleToolResult = useCallback((messageId: string, toolCallId: string) => {
    const key = getToolResultKey(messageId, toolCallId);
    setExpandedToolResultsByKey((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const handleReuseMessage = useCallback((content: string) => {
    if (!activeThreadId) return;
    updateInputDraft(activeThreadId, () => content);
    inputRef.current?.focus();
  }, [activeThreadId, updateInputDraft]);

  const handlePromptSuggestion = useCallback((prompt: string) => {
    if (!activeThreadId) return;
    updateInputDraft(activeThreadId, (current) => (current.trim().length > 0 ? `${current}\n${prompt}` : prompt));
    inputRef.current?.focus();
  }, [activeThreadId, updateInputDraft]);

  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText || !content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => (current === messageId ? null : current));
      }, COPY_RESET_DELAY_MS);
    } catch (error: unknown) {
      console.warn('Failed to copy message content:', error);
    }
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
      <div className="flex items-start justify-between gap-4 px-8 pt-6 pb-4 shrink-0 flex-wrap border-b border-border/50 bg-background/95">
        <div className="min-w-0 flex-1">
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
            >
              {thread.title}
            </h2>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span className="thread-header-chip">{thread.projectName}</span>
            <span className="thread-header-chip">{threadModeLabel}</span>
            <span className="thread-header-chip">{messageCountLabel}</span>
            {hasActiveDraft && (
              <span className="thread-header-chip thread-header-chip-active" data-testid="thread-draft-indicator">
                Draft saved locally
              </span>
            )}
            {otherDraftCount > 0 && (
              <span className="thread-header-chip">
                {otherDraftCount} other draft{otherDraftCount === 1 ? '' : 's'}
              </span>
            )}
            {isThreadRunning && (
              <span className="thread-message-badge thread-message-badge-active">
                <Loader2 className="h-3 w-3 animate-spin" />
                Responding
              </span>
            )}
          </div>
        </div>
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
          className="thread-chat-scroll flex-1 min-h-0 overflow-y-auto"
          role="log"
          aria-label="Thread conversation"
          aria-live="polite"
          aria-busy={isThreadRunning}
          onScroll={handleChatScroll}
        >
          <div className="px-8 py-5">
            {thread.messages.length === 0 && (
              <div className="thread-empty-state">
                <div className="thread-empty-icon">
                  <LoomIcon className="w-12 h-12 text-primary/75" strokeWidth={1} />
                </div>
                <p className="text-foreground text-[16px] font-semibold">Start with a clear request</p>
                <p className="max-w-xl text-center text-muted-foreground text-sm leading-6">
                  Copilot can inspect code, run commands, edit files, and explain what changed without leaving this thread.
                </p>
                <div className="flex max-w-2xl flex-wrap justify-center gap-2 px-4">
                  {promptSuggestions.map((suggestion) => (
                    <Button
                      key={suggestion.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="thread-prompt-chip h-9 rounded-full px-4 text-xs"
                      onClick={() => handlePromptSuggestion(suggestion.prompt)}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {suggestion.label}
                    </Button>
                  ))}
                </div>
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
                isToolsExpanded={isToolCallsExpanded(msg)}
                isCopied={copiedMessageId === msg.id}
                isToolResultExpanded={isToolResultExpanded}
                onToggleThinking={toggleThinking}
                onShowFullThinking={showFullThinking}
                onToggleToolCalls={toggleToolCalls}
                onToggleToolResult={toggleToolResult}
                onCopyMessage={handleCopyMessage}
                onReuseMessage={handleReuseMessage}
              />
            ))}
          </div>
        </div>

        {/* Permission approval banner */}
        {pendingPermission && (
          <div className="mx-8 mb-2 decision-card decision-card-warning">
            <div className="decision-card-icon">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="decision-card-eyebrow">Approval required</span>
                <p className="text-sm font-semibold text-foreground">
                  Allow <span className="font-mono">{pendingPermission.kind}</span> access?
                </p>
              </div>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Copilot is paused until you decide how this step should continue.
              </p>
              {(() => {
                const { kind: _kind, replyChannel: _replyChannel, ...rest } = pendingPermission;
                const details = [rest.toolName, rest.command, rest.path, rest.url]
                  .find((value): value is string => typeof value === 'string' && value.length > 0);
                return details ? (
                  <p className="mt-2 rounded-lg bg-background/70 px-3 py-2 text-[11px] text-muted-foreground font-mono break-all">
                    {details}
                  </p>
                ) : null;
              })()}
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="h-9 rounded-full border-destructive/40 px-4 text-xs text-destructive hover:bg-destructive/10"
                onClick={() => respondToPermission(false)}
              >
                Deny
              </Button>
              <Button
                size="sm"
                className="h-9 rounded-full bg-green-600 px-4 text-xs text-white hover:bg-green-700"
                onClick={() => respondToPermission(true)}
              >
                Allow
              </Button>
            </div>
          </div>
        )}

        {/* User-input request banner (ask_user tool) */}
        {pendingUserInput && (
          <div className="mx-8 mb-2 decision-card">
            <div className="decision-card-icon decision-card-icon-primary">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="decision-card-eyebrow">Input needed</span>
                  <p className="text-sm font-semibold text-foreground">{pendingUserInput.question}</p>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Your answer goes straight back into the current Copilot turn.
                </p>
              </div>
              {pendingUserInput.choices && pendingUserInput.choices.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pendingUserInput.choices.map((choice: string, index: number) => (
                    <Button
                      key={`${choice}-${index}`}
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-full px-4 text-xs"
                      onClick={() => respondToUserInput(choice)}
                    >
                      {choice}
                    </Button>
                  ))}
                </div>
              )}
              {(pendingUserInput.allowFreeform !== false || !pendingUserInput.choices?.length) && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 rounded-xl border border-border bg-background/80 px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                    placeholder="Type your answer..."
                    value={userInputAnswer}
                    onChange={(e) => {
                      if (!activeThreadId) return;
                      setUserInputAnswerByThread((prev) => ({ ...prev, [activeThreadId]: e.target.value }));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && userInputAnswer.trim()) {
                        respondToUserInput(userInputAnswer.trim());
                      }
                    }}
                    autoFocus
                  />
                  <Button
                    size="sm"
                    className="h-10 rounded-xl px-4 text-xs"
                    disabled={!userInputAnswer.trim()}
                    onClick={() => respondToUserInput(userInputAnswer.trim())}
                  >
                    Send
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {showJumpToLatest && (
          <div className="px-8 pb-2 flex justify-end" data-testid="thread-jump-to-latest-shell">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="thread-jump-to-latest"
              className="h-9 rounded-full border-border/80 bg-background/95 px-4 text-xs shadow-sm"
              onClick={() => scrollToBottom(true)}
            >
              <ChevronDown className="w-3.5 h-3.5" />
              <span data-testid="thread-jump-to-latest-label">Jump to latest</span>
            </Button>
          </div>
        )}

        {/* Input */}
        <div className="px-8 pb-6 pt-3">
          <div className="thread-composer-shell">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span className="thread-header-chip">{thread.projectName}</span>
                <span className="thread-header-chip">{messageCountLabel}</span>
                {hasActiveDraft ? (
                  <span className="thread-header-chip thread-header-chip-active">Draft stays with this thread</span>
                ) : (
                  <span className="thread-header-chip">Ready for the next prompt</span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                Enter to send · Shift+Enter for new line
              </p>
            </div>
            <div className="mt-3 flex items-end gap-2 rounded-[20px] border border-border/80 bg-background/85 p-2 shadow-sm">
              <textarea
                data-testid="thread-input"
                data-loom-chat-input="true"
                ref={inputRef}
                aria-label="Chat message input"
                className="min-h-[44px] flex-1 resize-none bg-transparent px-3.5 py-2 text-sm font-sans leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
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
                  className="h-11 w-11 rounded-2xl shrink-0"
                  aria-label="Stop response"
                  onClick={handleCancel}
                >
                  <Square className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  data-testid="thread-send"
                  size="icon"
                  className="h-11 w-11 rounded-2xl shrink-0"
                  aria-label="Send message"
                  onClick={handleSend}
                  disabled={!input.trim()}
                >
                  <Send className="w-4 h-4" />
                </Button>
              )}
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
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
              <p className="text-[11px] text-muted-foreground/70">
                Drafts stay scoped to each thread, so you can switch context without losing work.
              </p>
            </div>
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
