import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('shows a helpful empty state when no projects are configured', () => {
    render(<Sidebar />);
    expect(screen.getByText('No project opened yet')).toBeInTheDocument();
    expect(screen.getByText('Choose a folder to start')).toBeInTheDocument();
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

  it('ignores stale skills/agents/MCP loader results after project changes', async () => {
    const deferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => { resolve = res; });
      return { promise, resolve };
    };

    const skillsA = deferred<any>();
    const skillsB = deferred<any>();
    const agentsA = deferred<any>();
    const agentsB = deferred<any>();
    const mcpA = deferred<any>();
    const mcpB = deferred<any>();

    ipcRenderer.invoke.mockImplementation(async (channel: string, projectArg?: string) => {
      if (channel === 'auth:get-user') return { authenticated: false };
      if (channel === 'agent:list-skills') {
        return projectArg === '/tmp/project-a' ? skillsA.promise : skillsB.promise;
      }
      if (channel === 'agent:list-agents') {
        return projectArg === '/tmp/project-a' ? agentsA.promise : agentsB.promise;
      }
      if (channel === 'agent:list-project-mcp') {
        return projectArg === '/tmp/project-a' ? mcpA.promise : mcpB.promise;
      }
      return null;
    });

    const store = useAppStore.getState();
    store.setProject('/tmp/project-a', 'project-a');
    store.setProject('/tmp/project-b', 'project-b');
    store.setProject('/tmp/project-a', 'project-a');

    render(<Sidebar />);

    fireEvent.click(screen.getByText('Skills')); // load A
    act(() => {
      useAppStore.getState().setProject('/tmp/project-b', 'project-b');
    });
    fireEvent.click(screen.getByText('Skills')); // close
    fireEvent.click(screen.getByText('Skills')); // load B

    skillsB.resolve([{ name: 'skill-b', path: '/b.md', description: 'B' }]);
    await waitFor(() => expect(screen.getByText('skill-b')).toBeInTheDocument());
    skillsA.resolve([{ name: 'skill-a', path: '/a.md', description: 'A' }]);
    await waitFor(() => expect(screen.queryByText('skill-a')).not.toBeInTheDocument());

    act(() => {
      useAppStore.getState().setProject('/tmp/project-a', 'project-a');
    });
    fireEvent.click(screen.getByText('Agents')); // load A
    act(() => {
      useAppStore.getState().setProject('/tmp/project-b', 'project-b');
    });
    fireEvent.click(screen.getByText('Agents')); // close
    fireEvent.click(screen.getByText('Agents')); // load B

    agentsB.resolve([{ name: 'agent-b', path: '/b.agent.md', description: 'B' }]);
    await waitFor(() => expect(screen.getByText('agent-b')).toBeInTheDocument());
    agentsA.resolve([{ name: 'agent-a', path: '/a.agent.md', description: 'A' }]);
    await waitFor(() => expect(screen.queryByText('agent-a')).not.toBeInTheDocument());

    act(() => {
      useAppStore.getState().setProject('/tmp/project-a', 'project-a');
    });
    fireEvent.click(screen.getByText('MCP Servers')); // load A
    act(() => {
      useAppStore.getState().setProject('/tmp/project-b', 'project-b');
    });
    fireEvent.click(screen.getByText('MCP Servers')); // close
    fireEvent.click(screen.getByText('MCP Servers')); // load B

    mcpB.resolve({ 'mcp-b': { command: 'npx', args: ['b'] } });
    await waitFor(() => expect(screen.getByText('mcp-b')).toBeInTheDocument());
    mcpA.resolve({ 'mcp-a': { command: 'npx', args: ['a'] } });
    await waitFor(() => expect(screen.queryByText('mcp-a')).not.toBeInTheDocument());
  });
});
