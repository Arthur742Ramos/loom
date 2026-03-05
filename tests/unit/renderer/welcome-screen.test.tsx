import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WelcomeScreen } from '../../../src/renderer/components/WelcomeScreen';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { createMockIpcRenderer, installElectronMock, MockIpcRenderer } from '../../utils/mockElectronRenderer';
import { resetAppStore } from '../../utils/resetAppStore';

describe('WelcomeScreen', () => {
  let ipcRenderer: MockIpcRenderer;
  let restoreRequire: () => void;

  beforeEach(() => {
    resetAppStore();
    ipcRenderer = createMockIpcRenderer();
    ipcRenderer.invoke.mockImplementation(async (channel: string) => {
      if (channel === 'project:select-dir') return '/tmp/loom-project';
      return null;
    });
    restoreRequire = installElectronMock(ipcRenderer);
  });

  afterEach(() => {
    restoreRequire();
    resetAppStore();
  });

  it('opens project picker and saves selected project', async () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByTestId('welcome-add-project-button'));

    await waitFor(() =>
      expect(useAppStore.getState().projectPath).toBe('/tmp/loom-project'),
    );
    expect(useAppStore.getState().projectName).toBe('loom-project');
  });
});
