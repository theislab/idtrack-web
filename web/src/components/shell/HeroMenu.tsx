// The home's picture menu (DIRECTION.md, "The home"): a small button in the masthead's tools, on the home only, that
// opens a menu of the three pictures, the one shown checked. A menu of radio items: the arrow keys, Home and End
// move; Enter or Space chooses; Escape closes and returns the focus to the button; Tab closes.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { chooseHero, HERO_CHOICES, useHeroChoice } from "../../lib/hero/choice";

export function HeroMenu() {
  const id = useId();
  const choice = useHeroChoice();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
    };
  }, [open]);
  const close = (focus: boolean) => {
    setOpen(false);
    if (focus) button.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      event.preventDefault();
      items[(i + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") go(at + 1);
    else if (event.key === "ArrowUp") go(at - 1);
    else if (event.key === "Home") go(0);
    else if (event.key === "End") go(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") close(false);
  };
  return (
    <div className="hero-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="hero-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label="Choose the home page picture"
        title="Choose the home page picture"
        onClick={() => {
          setOpen((o) => !o);
        }}
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
          <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2.4 11.6l3.6-3.4 2.6 2.4 2-1.8 3 2.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="10.6" cy="5.8" r="1.2" fill="currentColor" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label="Home page picture"
          className="hero-menu__list"
          tabIndex={-1}
          onKeyDown={onKeyDown}
        >
          {HERO_CHOICES.map((c) => (
            <div
              key={c.value}
              role="menuitemradio"
              aria-checked={c.value === choice}
              tabIndex={-1}
              className="hero-menu__item"
              onClick={() => {
                chooseHero(c.value);
                close(true);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  chooseHero(c.value);
                  close(true);
                }
              }}
            >
              <span className="hero-menu__check" aria-hidden="true">
                {c.value === choice ? (
                  <svg viewBox="0 0 16 16" width="14" height="14" focusable="false">
                    <path
                      d="M3 8.5l3.2 3L13 4.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : null}
              </span>
              {c.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
