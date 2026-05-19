import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { color, primaryBtn } from "./platform/theme";

type EBState = { err: Error | null; info: string | null };

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  EBState
> {
  state: EBState = { err: null, info: null };
  static getDerivedStateFromError(err: Error): EBState {
    return { err, info: null };
  }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    console.error("[RootErrorBoundary]", err, info);
    this.setState({ err, info: info.componentStack ?? null });
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: color.bg.canvas,
          color: color.danger.text,
          padding: 24,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          overflow: "auto",
          boxSizing: "border-box",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
          Editor crashed
        </div>
        <div style={{ color: color.danger.text, marginBottom: 12 }}>
          {this.state.err.message}
        </div>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            color: color.text.muted,
            fontSize: 11,
            margin: 0,
          }}
        >
          {this.state.err.stack}
        </pre>
        {this.state.info && (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              color: color.text.dim,
              fontSize: 10,
              marginTop: 12,
            }}
          >
            {this.state.info}
          </pre>
        )}
        <button
          onClick={() => this.setState({ err: null, info: null })}
          style={{
            marginTop: 16,
            ...primaryBtn({ size: "sm" }),
          }}
        >
          Reset
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>,
);
