import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../../../src/renderer/components/SettingsPanel';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('SettingsPanel', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreElectronMock: () => void;
  const clickAndFlush = async (element: Element) => {
    await act(async () => {
      fireEvent.click(element);
      await Promise.resolve();
    });
  };

  const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  };

  const renderOpenSettings = async (
    state: Partial<Pick<ReturnType<typeof useAppStore.getState>, 'theme' | 'projectPath' | 'projectName'>> = {},
  ) => {
    await act(async () => {
      useAppStore.setState({ showSettings: true, ...state });
      render(<SettingsPanel />);
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    resetAppStore();
    ipcRenderer = createMockIpcRenderer();
    ipcRenderer.invoke.mockImplementation(async (channel: string, projectPath?: string) => {
      if (channel === 'app:get-version') return new Promise(() => {});
      if (channel === 'auth:get-user') return { authenticated: true, user: { login: 'octocat' } };
      if (channel === 'agent:list-models') return { success: true, models: [{ id: 'gpt-4.1' }] };
      if (channel === 'agent:list-project-mcp') {
        return projectPath ? { cloudbuild: { url: 'https://cloudbuild.example.com/mcp' } } : {};
      }
      if (channel === 'updater:check') return { available: false };
      return null;
    });
    restoreElectronMock = installElectronMock(ipcRenderer);
  });

  afterEach(() => {
    cleanup();
    restoreElectronMock();
    act(() => {
      resetAppStore();
    });
  });

  it('renders when showSettings is true', async () => {
    await renderOpenSettings();
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
  });

  it('does not render when showSettings is false', async () => {
    await act(async () => {
      useAppStore.setState({ showSettings: false });
      render(<SettingsPanel />);
      await Promise.resolve();
    });
    expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument();
  });

  it('theme selection updates store', async () => {
    await renderOpenSettings({ theme: 'system' });

    await clickAndFlush(screen.getByText('Dark'));
    expect(useAppStore.getState().theme).toBe('dark');

    await clickAndFlush(screen.getByText('Light'));
    expect(useAppStore.getState().theme).toBe('light');
  });

  it('backdrop click closes panel', async () => {
    await renderOpenSettings();

    const backdrop = screen.getByTestId('settings-panel');
    await clickAndFlush(backdrop);

    expect(useAppStore.getState().showSettings).toBe(false);
  });

  it('X button closes panel', async () => {
    await renderOpenSettings();

    await clickAndFlush(screen.getByTestId('settings-close-button'));
    expect(useAppStore.getState().showSettings).toBe(false);
  });

  it('Escape key closes panel', async () => {
    await renderOpenSettings();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
      await Promise.resolve();
    });
    expect(useAppStore.getState().showSettings).toBe(false);
  });

  it('displays runtime app version from IPC', async () => {
    ipcRenderer.invoke.mockImplementationOnce(async () => ({ version: '0.3.0' }));
    await renderOpenSettings();

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText('v0.3.0')).toBeInTheDocument();
    });
  });

  it('shows a version placeholder while app metadata is loading', async () => {
    const versionRequest = deferred<{ version?: string }>();
    ipcRenderer.invoke.mockImplementation(async (channel: string, projectPath?: string) => {
      if (channel === 'app:get-version') return versionRequest.promise;
      if (channel === 'auth:get-user') return { authenticated: true, user: { login: 'octocat' } };
      if (channel === 'agent:list-models') return { success: true, models: [{ id: 'gpt-4.1' }] };
      if (channel === 'agent:list-project-mcp') {
        return projectPath ? { cloudbuild: { url: 'https://cloudbuild.example.com/mcp' } } : {};
      }
      if (channel === 'updater:check') return { available: false };
      return null;
    });

    await renderOpenSettings();

    await waitFor(() => expect(screen.getByTestId('settings-version-loading')).toBeInTheDocument());

    versionRequest.resolve({ version: '0.3.0' });

    await waitFor(() => {
      expect(screen.getByText('v0.3.0')).toBeInTheDocument();
    });
  });

  it('reuses the loaded app version when reopening settings', async () => {
    const getVersion = vi.fn(async () => ({ version: '0.3.0' }));
    ipcRenderer.invoke.mockImplementation(async (channel: string, projectPath?: string) => {
      if (channel === 'app:get-version') return getVersion();
      if (channel === 'auth:get-user') return { authenticated: true, user: { login: 'octocat' } };
      if (channel === 'agent:list-models') return { success: true, models: [{ id: 'gpt-4.1' }] };
      if (channel === 'agent:list-project-mcp') {
        return projectPath ? { cloudbuild: { url: 'https://cloudbuild.example.com/mcp' } } : {};
      }
      if (channel === 'updater:check') return { available: false };
      return null;
    });

    await renderOpenSettings();

    await waitFor(() => expect(screen.getByText('v0.3.0')).toBeInTheDocument());
    expect(getVersion).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('settings-close-button'));

    act(() => {
      useAppStore.getState().setShowSettings(true);
    });

    await waitFor(() => expect(screen.getByText('v0.3.0')).toBeInTheDocument());
    expect(getVersion).toHaveBeenCalledTimes(1);
  });

  it('runs integration diagnostics and renders check summaries', async () => {
    await renderOpenSettings({
      projectPath: '/tmp/loom-project',
      projectName: 'loom-project',
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-run-diagnostics'));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId('settings-diagnostics-results')).toBeInTheDocument());
    expect(screen.getByTestId('settings-diagnostics-github')).toHaveTextContent('@octocat');
    expect(screen.getByTestId('settings-diagnostics-copilot')).toHaveTextContent('1 model(s) available');
    expect(screen.getByTestId('settings-diagnostics-mcp')).toHaveTextContent('cloudbuild');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:list-project-mcp', '/tmp/loom-project');
  });

  it('runs integration checks in parallel and shows a loading state', async () => {
    const authRequest = deferred<{ authenticated: boolean; user?: { login?: string } }>();
    const modelsRequest = deferred<{ success: boolean; models?: { id: string }[] }>();
    const mcpRequest = deferred<Record<string, unknown>>();

    ipcRenderer.invoke.mockImplementation(async (channel: string, projectPath?: string) => {
      if (channel === 'app:get-version') return { version: '0.3.0' };
      if (channel === 'auth:get-user') return authRequest.promise;
      if (channel === 'agent:list-models') return modelsRequest.promise;
      if (channel === 'agent:list-project-mcp') return mcpRequest.promise;
      if (channel === 'updater:check') return { available: false };
      return null;
    });

    await renderOpenSettings({
      projectPath: '/tmp/loom-project',
      projectName: 'loom-project',
    });

    await clickAndFlush(screen.getByTestId('settings-run-diagnostics'));

    await waitFor(() => expect(screen.getByTestId('settings-diagnostics-loading')).toBeInTheDocument());
    expect(screen.getByTestId('settings-run-diagnostics')).toBeDisabled();
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('auth:get-user');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:list-models');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:list-project-mcp', '/tmp/loom-project');

    authRequest.resolve({ authenticated: true, user: { login: 'octocat' } });
    modelsRequest.resolve({ success: true, models: [{ id: 'gpt-4.1' }] });
    mcpRequest.resolve({ cloudbuild: { url: 'https://cloudbuild.example.com/mcp' } });

    await waitFor(() => expect(screen.getByTestId('settings-diagnostics-results')).toBeInTheDocument());
    expect(screen.getByTestId('settings-diagnostics-github')).toHaveTextContent('@octocat');
  });
});
