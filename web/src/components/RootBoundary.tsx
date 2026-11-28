// The last boundary, around the whole app: should the shell itself fail, the page still says so and offers a reload,
// in plain markup that needs nothing of the app.
import { Component, type ReactNode } from "react";

export class RootBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  override state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error("An unknown error.") };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main id="main" className="page root-failure">
        <div className="notice notice--danger" role="alert">
          <h1 className="notice__title">IDTrack could not draw this page</h1>
          <p>
            It met an error: {error instanceof Error ? error.message : "an error without a message"}. Reload the page;
            if it persists, report it with the page&apos;s address.
          </p>
          <div className="notice__actions">
            <button
              type="button"
              className="button button--primary"
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload the page
            </button>
          </div>
        </div>
      </main>
    );
  }
}
