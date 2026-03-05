import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../../../src/renderer/App';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('App', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreRequire: () => void;
  let originalMatchMedia: typeof window.matchMedia;

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
    window.matchMedia = originalMatchMedia;
    restoreRequire();
    resetAppStore();
  });

  it('renders welcome screen when no project is selected', () => {
    render(<App />);
    expect(screen.getByTestId('welcome-screen')).toBeInTheDocument();
  });

  it('renders thread panel when active thread exists', () => {
    const store = useAppStore.getState();
    store.setProject('/tmp/app-project', 'app-project');
    const threadId = store.createThread('Thread in app', 'local');
    store.setActiveThread(threadId);

    render(<App />);
    expect(screen.getByTestId('thread-panel')).toBeInTheDocument();
  });
});
