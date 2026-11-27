// Never a white page: a part of the page that fails (its code did not arrive, or it met an error while drawing) is
// replaced by a plain statement of what failed and a way on, in its own place; the rest of the page stays. A boundary
// starts again when its `resetKey` changes (another address), and a part whose code did not arrive because the browser
// was offline is fetched again by itself when the connection returns.
import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkError, refetchStylesheets, reloadForCode } from "../lib/chunks";
import { retryFailedParts } from "../lib/lazyPart";
import { Button } from "./ui";

/** An error's message, for a statement. */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "an error without a message";
}

interface Props {
  children: ReactNode;
  /** What this part is, for the statement: "This page", "The answer", "The load monitor". */
  part: string;
  /** Another value starts the boundary again (the address of the page, the key of an answer). */
  resetKey?: string | undefined;
  /** `inline`: a one-line statement for a small part (a control of the masthead). */
  size?: "block" | "inline";
  /** The level of the statement's heading where it is a block. */
  level?: 2 | 3;
  /** The part is a whole page: its statement sits in the page's frame. */
  framed?: boolean;
}

interface State {
  error: unknown;
  key: string | undefined;
  offline: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, key: undefined, offline: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error("An unknown error."), offline: !navigator.onLine };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null };
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Code that did not arrive while the browser is online is most often a site updated since the page was opened:
    // its parts were renamed. One reload fetches the current site (what was typed is kept); a part missing again after
    // it is stated here.
    if (isChunkError(error) && navigator.onLine && reloadForCode()) return;
    if (!isChunkError(error)) {
      // A fault of the page: the browser's console keeps where it happened, for a report.
      // eslint-disable-next-line no-console -- the one place a fault of the page is written down
      console.error(error, info.componentStack);
    }
  }

  override componentDidUpdate(_props: Props, previous: State): void {
    if (this.state.error && !previous.error && isChunkError(this.state.error) && this.state.offline) {
      window.addEventListener("online", this.retry, { once: true });
    }
  }

  override componentWillUnmount(): void {
    window.removeEventListener("online", this.retry);
  }

  retry = (): void => {
    window.removeEventListener("online", this.retry);
    retryFailedParts();
    void refetchStylesheets().then(() => {
      this.setState({ error: null, offline: false });
    });
  };

  override render(): ReactNode {
    const { error, offline } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkError(error);
    const { part, size = "block", level = 2 } = this.props;
    const reload = (
      <Button
        onClick={() => {
          window.location.reload();
        }}
      >
        Reload the page
      </Button>
    );
    if (size === "inline") {
      return (
        <span className="boundary-inline" role="alert">
          {chunk && offline
            ? `${part} is not loaded: the browser is offline; it loads when the connection returns.`
            : `${part} ${chunk ? "could not be loaded" : "failed"}.`}{" "}
          <button type="button" className="boundary-inline__retry" onClick={this.retry}>
            Try again
          </button>
        </span>
      );
    }
    // A whole page's statement is the page's heading; a part's sits below the page's.
    const Heading = this.props.framed ? "h1" : level === 3 ? "h3" : "h2";
    const title = chunk
      ? offline
        ? `${part} is not loaded: the browser is offline`
        : `${part} could not be loaded`
      : `${part} failed while it was drawn`;
    const text = chunk
      ? offline
        ? "Its code is fetched when it is first needed, and the browser has no connection now. It loads by itself when the connection returns; what you typed is kept."
        : "The browser could not fetch its code: the connection failed, or the site was updated since this page was opened. Try again, or reload the page to fetch the current site; what you typed is kept."
      : `It met an error: ${errorText(error)}. This is a fault of the page, not of your request. Try again or reload the page; if it persists, report it with the page's address.`;
    const statement = (
      <div className="notice notice--danger boundary" role="alert">
        <Heading className="notice__title">{title}</Heading>
        <p>{text}</p>
        <div className="notice__actions">
          <Button onClick={this.retry}>Try again</Button> {reload}
        </div>
      </div>
    );
    return this.props.framed ? <div className="page">{statement}</div> : statement;
  }
}
