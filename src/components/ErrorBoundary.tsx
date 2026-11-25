import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Last line of defence: a render error shows a recovery screen instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[AuroraBR] UI error:", error);
  }

  reset = () => {
    try {
      localStorage.removeItem("aurora.lastAnalysis.v1");
    } catch {
      /* ignore */
    }
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center bg-black p-8">
        <div className="max-w-lg rounded-xl border border-aurora-crimson/40 bg-aurora-card p-6">
          <h1 className="text-lg font-semibold text-aurora-crimson">Something went wrong</h1>
          <p className="mt-2 text-sm text-neutral-400">
            The interface hit an unexpected error. Your Shader Tracker data is safe in the local database.
          </p>
          <pre className="selectable mt-4 max-h-40 overflow-auto rounded bg-black p-3 font-mono text-xs text-neutral-400">
            {this.state.error.message}
          </pre>
          <button className="btn-primary mt-4" onClick={this.reset}>
            Reload interface
          </button>
        </div>
      </div>
    );
  }
}
