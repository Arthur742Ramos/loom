import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsPanel } from '../../../src/renderer/components/SettingsPanel';
import { useAppStore } from '../../../src/renderer/store/appStore';
import { resetAppStore } from '../../utils/resetAppStore';

describe('SettingsPanel', () => {
  beforeEach(() => {
    resetAppStore();
  });

  afterEach(() => {
    resetAppStore();
  });

  it('renders when showSettings is true', () => {
    useAppStore.setState({ showSettings: true });
    render(<SettingsPanel />);
    expect(screen.getByTestId('settings-panel')).toBeInTheDocument();
  });

  it('does not render when showSettings is false', () => {
    useAppStore.setState({ showSettings: false });
    render(<SettingsPanel />);
    expect(screen.queryByTestId('settings-panel')).not.toBeInTheDocument();
  });

  it('theme selection updates store', () => {
    useAppStore.setState({ showSettings: true, theme: 'system' });
    render(<SettingsPanel />);

    fireEvent.click(screen.getByText('Dark'));
    expect(useAppStore.getState().theme).toBe('dark');

    fireEvent.click(screen.getByText('Light'));
    expect(useAppStore.getState().theme).toBe('light');
  });

  it('backdrop click closes panel', () => {
    useAppStore.setState({ showSettings: true });
    render(<SettingsPanel />);

    const backdrop = screen.getByTestId('settings-panel');
    fireEvent.click(backdrop);

    expect(useAppStore.getState().showSettings).toBe(false);
  });

  it('X button closes panel', () => {
    useAppStore.setState({ showSettings: true });
    render(<SettingsPanel />);

    fireEvent.click(screen.getByTestId('settings-close-button'));
    expect(useAppStore.getState().showSettings).toBe(false);
  });
});
