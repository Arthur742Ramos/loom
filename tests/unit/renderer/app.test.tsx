import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../../../src/renderer/App';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('App', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreRequire: () => void;
  let originalMatchMedia: typeof window.matchMedia;
  const renderApp = async () => {
    await act(async () => {
      render(<App />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    resetAppStore();
    ipcRenderer = createMockIpcRenderer();
    ipcRenderer.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'auth:get-user') return { authenticated: false };
      return null;
    });
    restoreRequire = installElectronMock(ipcRenderer);

    originalMatchMedia = window.matchMedia;
    window.matchMedia = () =>
      ({
        matches: false,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
      }) as MediaQueryList;
  });

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    restoreRequire();
    resetAppStore();
  });

  it('renders welcome screen when no project is selected', async () => {
    await renderApp();
    expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
  });

  it('renders thread panel when active thread exists', async () => {
    const store = useAppStore.getState();
    act(() => {
      store.setProject('/tmp/app-project', 'app-project');
      const threadId = store.createThread('Thread in app', 'local');
      store.setActiveThread(threadId);
    });

    await renderApp();
    expect(screen.getByTestId('thread-panel')).toBeInTheDocument();
  });

  it('recovers from a stale active thread id by reopening the current project thread', async () => {
    const store = useAppStore.getState();
    let threadId = '';
    act(() => {
      store.setProject('/tmp/app-project', 'app-project');
      threadId = store.createThread('Recovered thread', 'local');
      useAppStore.setState({ activeThreadId: 'missing-thread' });
    });

    await renderApp();

    await waitFor(() => expect(useAppStore.getState().activeThreadId).toBe(threadId));
    expect(screen.getByTestId('thread-panel')).toBeInTheDocument();
  });
});
