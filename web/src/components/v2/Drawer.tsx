// A drawer (DIRECTION.md, "The disclosure components"): a side sheet over the page, from the right on a wide screen
// and from the bottom on a phone, with its own scroll. A native modal <dialog>: focus moves to its title when it opens,
// the page behind is inert, Escape or the close button closes it, and focus returns to what opened it.
import { useEffect, useId, useRef, type ReactNode } from "react";

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      opener.current = document.activeElement;
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
      heading.current?.focus();
    } else if (!open && element.open) {
      if (typeof element.close === "function") element.close();
      else element.removeAttribute("open");
      if (opener.current instanceof HTMLElement) opener.current.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className={`drawer ${className}`}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open ? (
        <div className="drawer__sheet">
          <div className="drawer__head">
            <div>
              <h2 className="drawer__title" id={`${id}-title`} tabIndex={-1} ref={heading}>
                {title}
              </h2>
              {subtitle ? <p className="drawer__subtitle">{subtitle}</p> : null}
            </div>
            <button type="button" className="drawer__close" onClick={onClose} aria-label="Close">
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
