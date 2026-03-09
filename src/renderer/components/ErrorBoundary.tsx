import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  pendingReset: boolean;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null, pendingReset: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, pendingReset: false };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Loom error boundary caught:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: Props) {
    if (this.state.pendingReset && prevProps.children !== this.props.children) {
      this.setState({ pendingReset: false });
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, pendingReset: true });
  };

  render() {
    if (this.state.pendingReset) {
      return null;
    }
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen w-screen bg-background text-foreground">
          <div className="text-center max-w-md px-6">
            <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-sm text-muted-foreground mb-4">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={this.handleReload}
              className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
