"use client";

import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from "react";
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

/** A disclosure for form controls; deliberately not an ARIA application menu. */
export function DisclosureMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    content.current
      ?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")
      ?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
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
          className={styles.menuContent}
          role="group"
          aria-label={`${label} controls`}
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
