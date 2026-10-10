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
  useLayoutEffect(() => {
    const panel = content.current;
    if (!floating || !open || !panel || !trigger.current) return;
    if (!panel.matches(":popover-open")) panel.showPopover?.();
    // Placed directly on the element (before paint, so it never shows in the wrong spot or hidden,
    // which would stop the first control taking focus). Natural height = content plus borders.
    const place = () => {
      if (!trigger.current) return;
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
      ?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")
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
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
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
