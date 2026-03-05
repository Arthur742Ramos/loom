import React, { useState, useRef, useEffect } from 'react';

export const TerminalView: React.FC<{ threadId: string; projectPath: string }> = ({ threadId, projectPath }) => {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!termRef.current) return;
    setConnected(false);
    setError(null);
    let cleanupFn: (() => void) | undefined;
    let cancelled = false;
    const initTerminal = async () => {
      try {
        const { Terminal } = await import('@xterm/xterm');
        const { FitAddon } = await import('@xterm/addon-fit');
        if (cancelled) return;
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
          const result = await api.invoke<{ pid?: number; error?: string }>('terminal:create', threadId, projectPath);
          if (cancelled) { term.dispose(); return; }
          if (result.pid) {
            setConnected(true);
            term.onData((data: string) => api.send('terminal:data', threadId, data));
            const unsub = api.on('terminal:data', (id: string, data: string) => {
              if (id === threadId) term.write(data);
            });
            const ro = new ResizeObserver(() => fitAddon.fit());
            ro.observe(termRef.current!);
            cleanupFn = () => {
              api.send('terminal:dispose', threadId);
              unsub();
              ro.disconnect();
              term.dispose();
            };
            return;
          }
          setError(result.error || 'Failed to connect terminal');
          const ro = new ResizeObserver(() => fitAddon.fit());
          ro.observe(termRef.current!);
          cleanupFn = () => {
            ro.disconnect();
            term.dispose();
          };
          return;
        } else {
          term.write('Terminal available in desktop mode\r\n$ ');
          setConnected(true);
        }

        const ro = new ResizeObserver(() => fitAddon.fit());
        ro.observe(termRef.current!);
        cleanupFn = () => { ro.disconnect(); term.dispose(); };
      } catch (err) {
        console.error('Terminal init error:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize terminal');
      }
    };
    initTerminal();
    return () => { cancelled = true; cleanupFn?.(); };
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
