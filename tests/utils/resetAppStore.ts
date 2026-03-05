import { FALLBACK_MODELS, useAppStore } from '../../src/renderer/store/appStore';

export function resetAppStore(): void {
  useAppStore.setState({
    githubUser: null,
    projects: [],
    projectPath: null,
    projectName: null,
    selectedModel: FALLBACK_MODELS[0].id,
    reasoningEffort: 'medium',
    availableModels: [...FALLBACK_MODELS],
    modelsLoading: false,
    threads: [],
    activeThreadId: null,
    permissionMode: 'ask',
    mcpServers: {},
    sidebarCollapsed: false,
    activeTab: 'chat',
    showSettings: false,
    theme: 'system',
  });

  if (typeof window !== 'undefined') {
    window.localStorage?.removeItem('loom-state');
  }
}
