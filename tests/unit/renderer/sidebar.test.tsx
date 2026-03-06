import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../../../src/renderer/components/Sidebar';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('Sidebar', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreRequire: () => void;
  const clickAndFlush = async (element: Element) => {
    await act(async () => {
      fireEvent.click(element);
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  const changeAndFlush = async (element: Element, value: string) => {
    await act(async () => {
      fireEvent.change(element, { target: { value } });
      await Promise.resolve();
    });
  };
  const renderSidebar = async () => {
    await act(async () => {
      render(<Sidebar />);
      await Promise.resolve();
    });
  };
  const setProject = (projectPath: string, projectName: string) => {
    act(() => {
      useAppStore.getState().setProject(projectPath, projectName);
    });
  };

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
    cleanup();
    restoreRequire();
    resetAppStore();
  });

  it('shows a helpful empty state when no projects are configured', async () => {
    await renderSidebar();
    expect(screen.getByText('No project opened yet')).toBeInTheDocument();
    expect(screen.getByText('Choose a folder to start')).toBeInTheDocument();
  });

  it('shows inline discovery guidance without an active project', async () => {
    await renderSidebar();

    await clickAndFlush(screen.getByRole('button', { name: 'MCP Servers' }));
    await clickAndFlush(screen.getByRole('button', { name: 'Skills' }));
    await clickAndFlush(screen.getByRole('button', { name: 'Agents' }));

    expect(screen.getByTestId('mcp-no-project')).toHaveTextContent('Open a project to discover MCP servers.');
    expect(screen.getByTestId('skills-no-project')).toHaveTextContent('Open a project to discover skills.');
    expect(screen.getByTestId('agents-no-project')).toHaveTextContent('Open a project to discover custom agents.');

    const discoveryCalls = ipcRenderer.invoke.mock.calls
      .filter(([channel]) => String(channel).startsWith('agent:list-') || channel === 'agent:inspect-project-mcp');
    expect(discoveryCalls).toHaveLength(0);
  });

  it('lets users choose a project from inline discovery guidance', async () => {
    await renderSidebar();

    await clickAndFlush(screen.getByRole('button', { name: 'Skills' }));
    await clickAndFlush(screen.getByTestId('skills-open-project'));

    await waitFor(() => expect(ipcRenderer.invoke).toHaveBeenCalledWith('project:select-dir'));
    await waitFor(() => expect(useAppStore.getState().projectPath).toBe('/tmp/sidebar-project'));
    await waitFor(() => expect(screen.getByTestId('skills-empty-state')).toBeInTheDocument());
  });

  it('creates a new thread for the active project', async () => {
    setProject('/tmp/sidebar-project', 'sidebar-project');

    await renderSidebar();
    await clickAndFlush(screen.getByTestId('new-thread-button'));

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
    setProject('/tmp/sidebar-project', 'sidebar-project');

    await renderSidebar();

    const branchSwitcher = await screen.findByTestId('project-branch-switcher');
    await waitFor(() => expect(branchSwitcher).toHaveValue('main'));

    await changeAndFlush(branchSwitcher, 'feature/neat-switcher');

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

    await renderSidebar();

    await waitFor(() => expect(screen.getByTestId('login-button')).not.toBeDisabled());
    await clickAndFlush(screen.getByTestId('login-button'));
    await waitFor(() =>
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('auth:login'),
    );

    // Device code panel should be shown
    await waitFor(() => expect(screen.getByTestId('device-code-panel')).toBeInTheDocument());
    expect(screen.getByText('ABCD-1234')).toBeInTheDocument();

    // Simulate auth completion via IPC event
    await act(async () => {
      ipcRenderer.emit('auth:login-complete', {
        authenticated: true,
        user: { login: 'octocat', name: 'Octo Cat', avatar_url: 'https://example.com/avatar.png' },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(useAppStore.getState().githubUser?.login).toBe('octocat'));

    await clickAndFlush(screen.getByTestId('logout-button'));
    await waitFor(() =>
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('auth:logout'),
    );
  });

  it('shows helpful empty states when discovery finds nothing for the active project', async () => {
    setProject('/tmp/sidebar-project', 'sidebar-project');

    await renderSidebar();

    await clickAndFlush(screen.getByRole('button', { name: 'MCP Servers' }));
    await clickAndFlush(screen.getByRole('button', { name: 'Skills' }));
    await clickAndFlush(screen.getByRole('button', { name: 'Agents' }));

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
      if (channel === 'agent:list-skills' || channel === 'agent:list-agents' || channel === 'agent:inspect-project-mcp') {
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
      if (channel === 'agent:inspect-project-mcp') {
        return {
          servers: { 'mcp-success': { command: 'npx', args: ['retry'] } },
          searchedFiles: ['.vscode/mcp.json', '.github/copilot/mcp.json'],
          sourceFile: '.github/copilot/mcp.json',
          issues: [],
        };
      }
      return null;
    });
    setProject('/tmp/sidebar-project', 'sidebar-project');

    await renderSidebar();

    await clickAndFlush(screen.getByRole('button', { name: 'MCP Servers' }));
    await clickAndFlush(screen.getByRole('button', { name: 'Skills' }));
    await clickAndFlush(screen.getByRole('button', { name: 'Agents' }));

    await waitFor(() => expect(screen.getByTestId('mcp-error')).toBeInTheDocument());
    expect(screen.getByTestId('skills-error')).toHaveTextContent("Couldn't load project skills.");
    expect(screen.getByTestId('agents-error')).toHaveTextContent("Couldn't load project agents.");

    await clickAndFlush(screen.getByTestId('mcp-retry'));
    await clickAndFlush(screen.getByTestId('skills-retry'));
    await clickAndFlush(screen.getByTestId('agents-retry'));

    await waitFor(() => expect(screen.getByText('mcp-success')).toBeInTheDocument());
    expect(screen.getByText('skill-success')).toBeInTheDocument();
    expect(screen.getByText('agent-success')).toBeInTheDocument();
  });

  it('shows discovery summaries and MCP recovery diagnostics for populated projects', async () => {
    ipcRenderer.invoke.mockImplementation(async (channel: string, projectPath?: string) => {
      if (channel === 'auth:get-user') return { authenticated: false };
      if (channel === 'agent:list-skills') {
        return [
          {
            name: 'copilot-instructions',
            path: `${projectPath}\\.github\\copilot-instructions.md`,
            description: 'Project-level instructions',
          },
          {
            name: 'build',
            path: `${projectPath}\\.github\\copilot\\skills\\build.md`,
            description: 'Build the project',
          },
        ];
      }
      if (channel === 'agent:list-agents') {
        return [{ name: 'reviewer', path: `${projectPath}\\.github\\agents\\reviewer.agent.md`, description: 'Review changes' }];
      }
      if (channel === 'agent:inspect-project-mcp') {
        return {
          servers: {
            cloudbuild: { url: 'https://example.invalid/mcp' },
          },
          searchedFiles: ['.vscode/mcp.json', '.github/copilot/mcp.json'],
          sourceFile: '.github/copilot/mcp.json',
          issues: [
            {
              severity: 'error',
              message: 'Skipped .vscode/mcp.json because it contains invalid JSON.',
            },
          ],
        };
      }
      return null;
    });
    setProject('/tmp/sidebar-project', 'sidebar-project');

    await renderSidebar();

    await clickAndFlush(screen.getByRole('button', { name: 'MCP Servers' }));
    await clickAndFlush(screen.getByRole('button', { name: 'Skills' }));
    await clickAndFlush(screen.getByRole('button', { name: 'Agents' }));

    await waitFor(() => expect(screen.getByTestId('skills-summary')).toBeInTheDocument());
    expect(screen.getByTestId('skills-summary')).toHaveTextContent('1 skill ready to mention, plus project instructions.');
    expect(screen.getByTestId('agents-summary')).toHaveTextContent('1 custom agent ready to mention.');
    expect(screen.getByTestId('mcp-diagnostics-warning')).toHaveTextContent('Recovered project MCP discovery with warnings.');
    expect(screen.getByText('cloudbuild')).toBeInTheDocument();
  });

  it('copies discovery error details for follow-up debugging', async () => {
    const originalClipboard = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    ipcRenderer.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'auth:get-user') return { authenticated: false };
      if (channel === 'agent:list-skills') throw new Error('EACCES: permission denied');
      return null;
    });
    setProject('/tmp/sidebar-project', 'sidebar-project');

    await renderSidebar();

    await clickAndFlush(screen.getByRole('button', { name: 'Skills' }));

    await waitFor(() => expect(screen.getByTestId('skills-error')).toBeInTheDocument());
    await clickAndFlush(screen.getByTestId('skills-copy-details'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Skills discovery')));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('EACCES: permission denied'));
    expect(screen.getByTestId('skills-copy-details')).toHaveTextContent('Copied details');

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
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
      if (channel === 'agent:inspect-project-mcp') {
        return projectArg === '/tmp/project-a' ? mcpA.promise : mcpB.promise;
      }
      return null;
    });

    setProject('/tmp/project-a', 'project-a');

    await renderSidebar();

    await clickAndFlush(screen.getByRole('button', { name: 'Skills' }));
    await clickAndFlush(screen.getByRole('button', { name: 'Agents' }));
    await clickAndFlush(screen.getByRole('button', { name: 'MCP Servers' }));

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
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('agent:inspect-project-mcp', '/tmp/project-b');
    });

    skillsB.resolve([{ name: 'skill-b', path: '/b.md', description: 'B' }]);
    agentsB.resolve([{ name: 'agent-b', path: '/b.agent.md', description: 'B' }]);
    mcpB.resolve({
      servers: { 'mcp-b': { command: 'npx', args: ['b'] } },
      searchedFiles: ['.vscode/mcp.json', '.github/copilot/mcp.json'],
      sourceFile: '.github/copilot/mcp.json',
      issues: [],
    });

    await waitFor(() => expect(screen.getByText('skill-b')).toBeInTheDocument());
    expect(screen.getByText('agent-b')).toBeInTheDocument();
    expect(screen.getByText('mcp-b')).toBeInTheDocument();

    skillsA.resolve([{ name: 'skill-a', path: '/a.md', description: 'A' }]);
    agentsA.resolve([{ name: 'agent-a', path: '/a.agent.md', description: 'A' }]);
    mcpA.resolve({
      servers: { 'mcp-a': { command: 'npx', args: ['a'] } },
      searchedFiles: ['.vscode/mcp.json', '.github/copilot/mcp.json'],
      sourceFile: '.github/copilot/mcp.json',
      issues: [],
    });

    await waitFor(() => {
      expect(screen.queryByText('skill-a')).not.toBeInTheDocument();
      expect(screen.queryByText('agent-a')).not.toBeInTheDocument();
      expect(screen.queryByText('mcp-a')).not.toBeInTheDocument();
    });
  });
});
