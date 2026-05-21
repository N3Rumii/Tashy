import { Component, type ReactNode } from "react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; error?: Error; }

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return <div style={{ padding: 20, color: "var(--mantine-color-red-6)" }}>
        <h3>Something went wrong</h3>
        <p style={{ fontSize: 12 }}>{this.state.error?.message}</p>
        <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }} style={{ cursor: "pointer" }}>
          Reload app
        </button>
      </div>;
    }
    return this.props.children;
  }
}
