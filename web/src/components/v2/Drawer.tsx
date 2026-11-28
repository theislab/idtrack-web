// A drawer (DIRECTION.md, "The disclosure components"): a side sheet over the page, from the right on a wide screen
// and from the bottom on a phone, with its own scroll. A native modal <dialog>: focus moves to its title when it opens,
// the page behind is inert, Escape, the close button or a press on the dimmed page closes it (it glides out in 160 ms,
// at once under reduced motion), and focus returns to what opened it. Escape is offered first to the drawer's content
// (`onEscape`: a tip it shows hides before the drawer closes).
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useExit } from "./useExit";

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  className = "",
  id: givenId,
  closeLabel = "Close",
  onEscape,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The dialog's id (an opener's `aria-controls`). */
  id?: string;
  /** The close button's name ("Close the server load"). */
  closeLabel?: string;
  /** Escape, offered to the content first: true when it was taken (the drawer stays open). */
  onEscape?: () => boolean;
}) {
  const ownId = useId();
  const id = givenId ?? ownId;
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);
  const { shown, closing } = useExit(open);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open || element.open) return;
    opener.current = document.activeElement;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    heading.current?.focus();
  }, [open]);
  // Closed once its exit has run.
  useEffect(() => {
    const element = dialog.current;
    if (!element || shown || !element.open) return;
    if (typeof element.close === "function") element.close();
    else element.removeAttribute("open");
    if (opener.current instanceof HTMLElement) opener.current.focus();
  }, [shown]);
  // A press on the dimmed page lands on the dialog itself (its sheet fills the box): it closes the drawer. A dialog the
  // browser closed by itself (a close request it does not let the page hold) is closed for the page too.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const onClick = (event: MouseEvent) => {
      if (event.target === element) onClose();
    };
    const onClosed = () => {
      if (open) onClose();
    };
    element.addEventListener("click", onClick);
    element.addEventListener("close", onClosed);
    return () => {
      element.removeEventListener("click", onClick);
      element.removeEventListener("close", onClosed);
    };
  }, [onClose, open]);
  return (
    <dialog
      ref={dialog}
      id={givenId}
      className={`drawer ${className}${closing ? " drawer--closing" : ""}`}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!open || onEscape?.()) return;
        onClose();
      }}
    >
      {shown ? (
        <div className="drawer__sheet">
          <div className="drawer__head">
            <div>
              <h2 className="drawer__title" id={`${id}-title`} tabIndex={-1} ref={heading}>
                {title}
              </h2>
              {subtitle ? <p className="drawer__subtitle">{subtitle}</p> : null}
            </div>
            <button type="button" className="drawer__close" onClick={onClose} aria-label={closeLabel}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
                <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="drawer__body">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
