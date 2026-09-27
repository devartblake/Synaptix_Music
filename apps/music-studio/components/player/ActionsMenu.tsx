"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import styles from "./player.module.css";

export type ActionsMenuItem =
  | { kind: "action"; label: string; onSelect(): void; destructive?: boolean }
  | { kind: "link"; label: string; href: string };

/**
 * A glass "…" button that opens a menu of actions (ARIA menu button pattern): arrow keys move
 * between items, Home/End jump, Escape or Tab closes, and focus returns to the button.
 */
export function ActionsMenu({ label, items, icon }: { label: string; items: ActionsMenuItem[]; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const focusIndex = useRef(0);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[focusIndex.current]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function openAt(index: number) {
    focusIndex.current = index;
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  function onTriggerKeyDown(event: KeyboardEvent) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openAt(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openAt(items.length - 1);
    }
  }

  function onMenuKeyDown(event: KeyboardEvent) {
    const current = itemRefs.current.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      itemRefs.current[(index + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(current + 1);
    else if (event.key === "ArrowUp") move(current - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") close(false);
  }

  return (
    <div ref={root} className={styles.menuRoot}>
      <button ref={trigger} type="button" className={styles.iconButton} aria-label={label}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : openAt(0))} onKeyDown={onTriggerKeyDown}>
        {icon ?? <span aria-hidden="true" className={styles.moreGlyph}>•••</span>}
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className={styles.menu} onKeyDown={onMenuKeyDown}>
          {items.map((item, index) => {
            const className = `${styles.menuItem}${item.kind === "action" && item.destructive ? ` ${styles.menuItemDanger}` : ""}`;
            const ref = (element: HTMLElement | null) => { itemRefs.current[index] = element; };
            return item.kind === "link"
              ? <Link key={item.label} ref={ref} role="menuitem" tabIndex={-1} className={className} href={item.href}
                onClick={() => setOpen(false)}>{item.label}</Link>
              : <button key={item.label} ref={ref} type="button" role="menuitem" tabIndex={-1} className={className}
                onClick={() => { close(); item.onSelect(); }}>{item.label}</button>;
          })}
        </div>
      )}
    </div>
  );
}
