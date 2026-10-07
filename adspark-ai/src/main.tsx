import { Component, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import LegalPage, { type LegalPageKind } from "./components/LegalPage";
import "./index.css";

interface BoundaryState {
  failed: boolean;
}

/** Last line of defence: unexpected errors show a friendly message instead of a blank page. */
class ErrorBoundary extends Component<{ children?: unknown }, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="mx-auto max-w-md p-10 text-center">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-slate-600">Please refresh the page and try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white"
          >
            Refresh
          </button>
        </div>
      );
    }
    return this.props.children as never;
  }
}

const rootEl = document.getElementById("root");
if (rootEl) {
  const legalRoutes: Record<string, LegalPageKind> = {
    "/privacy-policy": "privacy",
    "/terms": "terms",
    "/refund-policy": "refund",
  };
  const legalPage = legalRoutes[window.location.pathname];
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        {legalPage ? <LegalPage page={legalPage} /> : <App />}
      </ErrorBoundary>
    </StrictMode>,
  );
}
