import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Sidebar } from '../../../src/renderer/components/Sidebar';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('Sidebar', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreRequire: () => void;

  beforeEach(() => {
    resetAppStore();
    ipcRenderer = createMockIpcRenderer();
    ipcRenderer.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'auth:get-user') return { authenticated: false };
      if (channel === 'auth:login') return { success: true };
      if (channel === 'auth:logout') return { success: true };
      if (channel === 'project:select-dir') return '/tmp/sidebar-project';
      return null;
    });
    restoreRequire = installElectronMock(ipcRenderer);
  });

  afterEach(() => {
    restoreRequire();
    resetAppStore();
  });

  it('creates a new thread for the active project', async () => {
    useAppStore.getState().setProject('/tmp/sidebar-project', 'sidebar-project');

    render(<Sidebar />);
    fireEvent.click(screen.getByTestId('new-thread-button'));

    await waitFor(() => expect(useAppStore.getState().threads).toHaveLength(1));
    expect(useAppStore.getState().threads[0].projectPath).toBe('/tmp/sidebar-project');
  });

  it('calls login and logout IPC handlers', async () => {
    ipcRenderer.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'auth:get-user') return { authenticated: false };
      if (channel === 'auth:login') return {
        success: true,
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
      };
      if (channel === 'auth:login-cancel') return { success: true };
      if (channel === 'auth:logout') return { success: true };
      return null;
    });

    render(<Sidebar />);

    await waitFor(() => expect(screen.getByTestId('login-button')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('login-button'));
    await waitFor(() =>
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('auth:login'),
    );

    // Device code panel should be shown
    await waitFor(() => expect(screen.getByTestId('device-code-panel')).toBeInTheDocument());
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument();

    // Simulate auth completion via IPC event
    ipcRenderer.emit('auth:login-complete', {
      authenticated: true,
      user: { login: 'octocat', name: 'Octo Cat', avatar_url: 'https://example.com/avatar.png' },
    });
    await waitFor(() => expect(useAppStore.getState().githubUser?.login).toBe('octocat'));

    fireEvent.click(screen.getByTestId('logout-button'));
    await waitFor(() =>
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('auth:logout'),
    );
  });
});
