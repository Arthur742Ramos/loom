import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPanel } from '../../../src/renderer/components/SettingsPanel';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('SettingsPanel', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreElectronMock: () => void;

  const renderOpenSettings = (
    state: Partial<Pick<ReturnType<typeof useAppStore.getState>, 'theme' | 'projectPath' | 'projectName'>> = {},
  ) => {
    act(() => {
      useAppStore.setState({ showSettings: true, ...state });
      render(<SettingsPanel />);
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
    renderOpenSettings();
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
  });

  it('does not render when showSettings is false', () => {
    useAppStore.setState({ showSettings: false });
    render(<SettingsPanel />);
    expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument();
  });

  it('theme selection updates store', async () => {
    renderOpenSettings({ theme: 'system' });

    fireEvent.click(screen.getByText('Dark'));
    expect(useAppStore.getState().theme).toBe('dark');

    fireEvent.click(screen.getByText('Light'));
    expect(useAppStore.getState().theme).toBe('light');
  });

  it('backdrop click closes panel', async () => {
    renderOpenSettings();

    const backdrop = screen.getByTestId('settings-panel');
    fireEvent.click(backdrop);

    expect(useAppStore.getState().showSettings).toBe(false);
  });

  it('X button closes panel', async () => {
    renderOpenSettings();

    fireEvent.click(screen.getByTestId('settings-close-button'));
    expect(useAppStore.getState().showSettings).toBe(false);
  });

  it('Escape key closes panel', async () => {
    renderOpenSettings();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useAppStore.getState().showSettings).toBe(false);
  });

  it('displays runtime app version from IPC', async () => {
    ipcRenderer.invoke.mockImplementationOnce(async () => ({ version: '0.3.0' }));
    renderOpenSettings();

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/Loom v0\.3\.0 · Powered by GitHub Copilot/i)).toBeInTheDocument();
    });
  });

  it('runs integration diagnostics and renders check summaries', async () => {
    renderOpenSettings({
      projectPath: '/tmp/loom-project',
      projectName: 'loom-project',
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-run-diagnostics'));
    });

    await waitFor(() => expect(screen.getByTestId('settings-diagnostics-results')).toBeInTheDocument());
    expect(screen.getByTestId('settings-diagnostics-github')).toHaveTextContent('@octocat');
    expect(screen.getByTestId('settings-diagnostics-copilot')).toHaveTextContent('1 model(s) available');
    expect(screen.getByTestId('settings-diagnostics-mcp')).toHaveTextContent('cloudbuild');
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:list-project-mcp', '/tmp/loom-project');
  });
});
