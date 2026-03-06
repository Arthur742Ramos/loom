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
    ipcRenderer.invoke.mockImplementation(async (channel: string, _projectPath?: string, branchName?: string) => {
      if (channel === 'auth:get-user') return { authenticated: false };
      if (channel === 'auth:login') return { success: true };
      if (channel === 'auth:logout') return { success: true };
      if (channel === 'project:select-dir') return '/tmp/sidebar-project';
      if (channel === 'git:list-branches') {
        return {
          branches: ['main', 'feature/neat-switcher'],
          current: 'main',
          detached: false,
        };
      }
      if (channel === 'git:checkout') {
        return { success: true, current: branchName };
      }
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

  it('shows inline discovery guidance without an active project', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'MCP Servers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    expect(screen.getByTestId('mcp-no-project')).toHaveTextContent('Open a project to discover MCP servers.');
    expect(screen.getByTestId('skills-no-project')).toHaveTextContent('Open a project to discover skills.');
    expect(screen.getByTestId('agents-no-project')).toHaveTextContent('Open a project to discover custom agents.');

    const discoveryCalls = ipcRenderer.invoke.mock.calls
      .filter(([channel]) => String(channel).startsWith('agent:list-'));
    expect(discoveryCalls).toHaveLength(0);
  });

  it('creates a new thread for the active project', async () => {
    useAppStore.getState().setProject('/tmp/sidebar-project', 'sidebar-project');

    render(<Sidebar />);
    fireEvent.click(screen.getByTestId('new-thread-button'));

    await waitFor(() => expect(useAppStore.getState().threads).toHaveLength(1));
    expect(useAppStore.getState().threads[0].projectPath).toBe('/tmp/sidebar-project');
  });

  it('loads branches and switches the active project branch', async () => {
    let currentBranch = 'main';
    ipcRenderer.invoke.mockImplementation(async (channel: string, projectPath?: string, branchName?: string) => {
      if (channel === 'auth:get-user') return { authenticated: false };
      if (channel === 'project:select-dir') return '/tmp/sidebar-project';
      if (channel === 'git:list-branches' && projectPath === '/tmp/sidebar-project') {
        return {
          branches: ['main', 'feature/neat-switcher'],
          current: currentBranch,
          detached: false,
        };
      }
      if (channel === 'git:checkout' && projectPath === '/tmp/sidebar-project') {
        currentBranch = branchName ?? currentBranch;
        return { success: true, current: currentBranch };
      }
      return null;
    });
    useAppStore.getState().setProject('/tmp/sidebar-project', 'sidebar-project');

    render(<Sidebar />);

    const branchSwitcher = await screen.findByTestId('project-branch-switcher');
    await waitFor(() => expect(branchSwitcher).toHaveValue('main'));

    fireEvent.change(branchSwitcher, { target: { value: 'feature/neat-switcher' } });

    await waitFor(() =>
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(
        'git:checkout',
        '/tmp/sidebar-project',
        'feature/neat-switcher',
      ));
    await waitFor(() =>
      expect(screen.getByTestId('project-branch-summary')).toHaveTextContent('feature/neat-switcher'));
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

  it('shows helpful empty states when discovery finds nothing for the active project', async () => {
    useAppStore.getState().setProject('/tmp/sidebar-project', 'sidebar-project');

    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'MCP Servers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    await waitFor(() => expect(screen.getByTestId('mcp-empty-state')).toBeInTheDocument());
    expect(screen.getByTestId('skills-empty-state')).toHaveTextContent('No project skills found.');
    expect(screen.getByTestId('agents-empty-state')).toHaveTextContent('No project agents found.');
  });

  it('shows inline errors and retries discovery loaders', async () => {
    const callCounts = new Map<string, number>();
    ipcRenderer.invoke.mockImplementation(async (channel: string, projectPath?: string, branchName?: string) => {
      if (channel === 'auth:get-user') return { authenticated: false };
      if (channel === 'git:list-branches') {
        return {
          branches: ['main', 'feature/neat-switcher'],
          current: 'main',
          detached: false,
        };
      }
      if (channel === 'git:checkout') {
        return { success: true, current: branchName };
      }
      if (channel === 'agent:list-skills' || channel === 'agent:list-agents' || channel === 'agent:list-project-mcp') {
        const nextCount = (callCounts.get(channel) ?? 0) + 1;
        callCounts.set(channel, nextCount);
        if (nextCount === 1) {
          throw new Error(`${channel} failed`);
        }
      }
      if (channel === 'agent:list-skills') {
        return [{ name: 'skill-success', path: `${projectPath}\\skill.md`, description: 'Skill retry' }];
      }
      if (channel === 'agent:list-agents') {
        return [{ name: 'agent-success', path: `${projectPath}\\agent.md`, description: 'Agent retry' }];
      }
      if (channel === 'agent:list-project-mcp') {
        return { 'mcp-success': { command: 'npx', args: ['retry'] } };
      }
      return null;
    });
    useAppStore.getState().setProject('/tmp/sidebar-project', 'sidebar-project');

    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'MCP Servers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));

    await waitFor(() => expect(screen.getByTestId('mcp-error')).toBeInTheDocument());
    expect(screen.getByTestId('skills-error')).toHaveTextContent("Couldn't load project skills.");
    expect(screen.getByTestId('agents-error')).toHaveTextContent("Couldn't load project agents.");

    fireEvent.click(screen.getByTestId('mcp-retry'));
    fireEvent.click(screen.getByTestId('skills-retry'));
    fireEvent.click(screen.getByTestId('agents-retry'));

    await waitFor(() => expect(screen.getByText('mcp-success')).toBeInTheDocument());
    expect(screen.getByText('skill-success')).toBeInTheDocument();
    expect(screen.getByText('agent-success')).toBeInTheDocument();
  });

  it('reloads expanded skills/agents/MCP sections on project change and ignores stale results', async () => {
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

    render(<Sidebar />);

    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    fireEvent.click(screen.getByRole('button', { name: 'MCP Servers' }));

    await waitFor(() => {
      expect(screen.getByTestId('skills-loading')).toBeInTheDocument();
      expect(screen.getByTestId('agents-loading')).toBeInTheDocument();
      expect(screen.getByTestId('mcp-loading')).toBeInTheDocument();
    });

    act(() => {
      useAppStore.getState().setProject('/tmp/project-b', 'project-b');
    });

    await waitFor(() => {
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:list-skills', '/tmp/project-b');
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:list-agents', '/tmp/project-b');
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:list-project-mcp', '/tmp/project-b');
    });

    skillsB.resolve([{ name: 'skill-b', path: '/b.md', description: 'B' }]);
    agentsB.resolve([{ name: 'agent-b', path: '/b.agent.md', description: 'B' }]);
    mcpB.resolve({ 'mcp-b': { command: 'npx', args: ['b'] } });

    await waitFor(() => expect(screen.getByText('skill-b')).toBeInTheDocument());
    expect(screen.getByText('agent-b')).toBeInTheDocument();
    expect(screen.getByText('mcp-b')).toBeInTheDocument();

    skillsA.resolve([{ name: 'skill-a', path: '/a.md', description: 'A' }]);
    agentsA.resolve([{ name: 'agent-a', path: '/a.agent.md', description: 'A' }]);
    mcpA.resolve({ 'mcp-a': { command: 'npx', args: ['a'] } });

    await waitFor(() => {
      expect(screen.queryByText('skill-a')).not.toBeInTheDocument();
      expect(screen.queryByText('agent-a')).not.toBeInTheDocument();
      expect(screen.queryByText('mcp-a')).not.toBeInTheDocument();
    });
  });
});
