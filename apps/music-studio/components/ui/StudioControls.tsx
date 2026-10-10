"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import styles from "./studio-controls.module.css";

export function Button({
  className = "",
  variant = "default",
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: "default" | "primary" | "quiet" }) {
  return (
    <button
      type={type}
      className={`${styles.button} ${styles[variant] ?? ""} ${className}`}
      {...props}
    />
  );
}

export function Panel({ className = "", ...props }: ComponentProps<"section">) {
  return <section className={`${styles.panel} ${className}`} {...props} />;
}

export function Toolbar({ className = "", ...props }: ComponentProps<"header">) {
  return <header className={`${styles.toolbar} ${className}`} {...props} />;
}

export function Badge({ className = "", ...props }: ComponentProps<"span">) {
  return <span className={`${styles.badge} ${className}`} {...props} />;
}

export function ViewTabs({
  label,
  tabs,
  value,
  onChange
}: {
  label: string;
  tabs: { value: string; label: string; panelId: string; disabled?: boolean }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root} className={styles.tabs} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <Button
          key={tab.value}
          role="tab"
          id={`${tab.panelId}-tab`}
          aria-controls={tab.panelId}
          aria-selected={tab.value === value}
          tabIndex={tab.value === value ? 0 : -1}
          disabled={tab.disabled}
          onClick={() => onChange(tab.value)}
          onKeyDown={(event) => {
            const enabled = tabs.filter((item) => !item.disabled);
            const index = enabled.findIndex((item) => item.value === tab.value);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? enabled.length - 1
                  : event.key === "ArrowRight"
                    ? (index + 1) % enabled.length
                    : event.key === "ArrowLeft"
                      ? (index + enabled.length - 1) % enabled.length
                      : null;
            if (next === null) return;
            event.preventDefault();
            const target = enabled[next];
            if (!target) return;
            onChange(target.value);
            root.current?.querySelector<HTMLButtonElement>(`[id="${target.panelId}-tab"]`)?.focus();
          }}
        >
          {tab.label}
        </Button>
      ))}
    </div>
  );
}

const FLOATING_GAP = 6;
const MOVE_STEP = 10;
const MOVE_STEP_LARGE = 40;

/** Puts a floating panel at left/top, kept wholly on screen, and returns where it ended up. */
function placeAt(panel: HTMLElement, left: number, top: number): { left: number; top: number } {
  const height = Math.min(panel.scrollHeight + panel.offsetHeight - panel.clientHeight, innerHeight - 2 * FLOATING_MARGIN);
  const x = Math.max(FLOATING_MARGIN, Math.min(left, innerWidth - panel.offsetWidth - FLOATING_MARGIN));
  const y = Math.max(FLOATING_MARGIN, Math.min(top, innerHeight - height - FLOATING_MARGIN));
  Object.assign(panel.style, { left: `${x}px`, top: `${y}px`, maxHeight: `${innerHeight - y - FLOATING_MARGIN}px` });
  return { left: x, top: y };
}

/**
 * The floating panel's grip: drag it to move the panel, or focus it and use the arrow keys
 * (Shift for bigger steps); Home puts the panel back beside its button.
 */
function MoveHandle({ label, panel, moved, onReset }: {
  label: string;
  panel: React.RefObject<HTMLDivElement | null>;
  moved: React.MutableRefObject<{ left: number; top: number } | null>;
  onReset: () => void;
}) {
  const moveTo = (left: number, top: number) => {
    if (panel.current) moved.current = placeAt(panel.current, left, top);
  };
  return (
    <button type="button" className={styles.moveHandle} data-move-handle=""
      aria-label={`Move ${label} panel`} title="Drag to move. Arrow keys move it; Home puts it back."
      onPointerDown={(event) => {
        if (!panel.current || event.button !== 0) return;
        event.preventDefault();
        const rect = panel.current.getBoundingClientRect();
        const origin = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
        // Window listeners rather than pointer capture, so the drag follows the pointer anywhere.
        const move = (moveEvent: PointerEvent) => moveTo(origin.left + moveEvent.clientX - origin.x, origin.top + moveEvent.clientY - origin.y);
        const end = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      }}
      onKeyDown={(event) => {
        if (event.key === "Home") {
          event.preventDefault();
          onReset();
          return;
        }
        const step = event.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP;
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
        if (!delta || !panel.current) return;
        event.preventDefault();
        const rect = panel.current.getBoundingClientRect();
        moveTo(rect.left + delta[0]!, rect.top + delta[1]!);
      }}>
      <span aria-hidden="true">⠿</span>{label}
    </button>
  );
}
const FLOATING_MARGIN = 8;

/** Where a floating panel goes: under the trigger, or above it when there is more room there. */
function floatingPosition(trigger: DOMRect, panel: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number; maxHeight: number } {
  const below = viewport.height - trigger.bottom - FLOATING_GAP - FLOATING_MARGIN;
  const above = trigger.top - FLOATING_GAP - FLOATING_MARGIN;
  const placeAbove = panel.height > below && above > below;
  const maxHeight = Math.max(120, placeAbove ? above : below);
  const height = Math.min(panel.height, maxHeight);
  // Right-aligned to the trigger, like the in-flow menu, and kept on screen.
  const left = Math.max(FLOATING_MARGIN, Math.min(trigger.right - panel.width, viewport.width - panel.width - FLOATING_MARGIN));
  return {
    left,
    top: placeAbove ? trigger.top - FLOATING_GAP - height : trigger.bottom + FLOATING_GAP,
    maxHeight
  };
}

/**
 * A disclosure for form controls; deliberately not an ARIA application menu. `floating` shows the
 * panel in the browser's top layer, positioned from the trigger, so a short or scrolling container
 * (like the DAW dock) can't clip or cover it, and what's behind it stays in view.
 */
export function DisclosureMenu({ label, children, floating = false }: { label: string; children: ReactNode; floating?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Where the person dragged the floating panel; it reopens there (kept on screen) until reset.
  const moved = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const panel = content.current;
    if (!floating || !open || !panel || !trigger.current) return;
    if (!panel.matches(":popover-open")) panel.showPopover?.();
    // Placed directly on the element (before paint, so it never shows in the wrong spot or hidden,
    // which would stop the first control taking focus). Natural height = content plus borders.
    const place = () => {
      if (!trigger.current) return;
      if (moved.current) {
        placeAt(panel, moved.current.left, moved.current.top);
        return;
      }
      const height = panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
      const { left, top, maxHeight } = floatingPosition(trigger.current.getBoundingClientRect(),
        { width: panel.offsetWidth, height }, { width: innerWidth, height: innerHeight });
      Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, maxHeight: `${maxHeight}px` });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [floating, open]);
  useEffect(() => {
    if (!open) return;
    content.current
      ?.querySelector<HTMLElement>(":is(button, input, select):not(:disabled):not([data-move-handle])")
      ?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    // A control that disables itself while its edit saves drops focus to the body, out of reach
    // of the root's key handler; Escape still closes the menu then.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.target !== document.body) return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className={styles.menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        // Only when focus moves to another element: a control that disables itself while its edit
        // saves blurs to nothing (newer browsers fire that blur), and outside clicks close it anyway.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Button ref={trigger} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {label}
      </Button>
      {open && (
        <div
          id={id}
          ref={content}
          className={floating ? `${styles.menuContent} ${styles.menuFloating}` : styles.menuContent}
          role="group"
          aria-label={`${label} controls`}
          popover={floating ? "manual" : undefined}
        >
          {floating && <MoveHandle label={label} panel={content} moved={moved} onReset={() => {
            moved.current = null;
            window.dispatchEvent(new Event("resize"));
          }} />}
          {children}
        </div>
      )}
    </div>
  );
}

export function MeterBar({
  label,
  value,
  clipped
}: {
  label: string;
  value: number;
  clipped: boolean;
}) {
  const bounded = Number.isFinite(value) ? Math.max(-60, Math.min(0, value)) : -60;
  return (
    <div
      className={styles.meter}
      role="meter"
      aria-label={label}
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={bounded}
      aria-valuetext={
        Number.isFinite(value)
          ? `${value.toFixed(1)} dBFS${clipped ? ", clipping" : ""}`
          : "Silence"
      }
    >
      <div
        style={{
          width: `${((bounded + 60) / 60) * 100}%`,
          background: clipped ? "var(--sx-danger)" : "var(--sx-active)"
        }}
      />
    </div>
  );
}
