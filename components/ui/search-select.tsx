"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

export type SearchOption = { label: string; value: string | number };

type Props = {
  options: SearchOption[];
  value?: string | number;
  onChange: (value: string | number) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  minMenuWidth?: number; // px, default 320
  maxMenuHeight?: number; // px, default 384
};

export const SearchSelect: React.FC<Props> = ({
  options,
  value,
  onChange,
  placeholder,
  className,
  disabled,
  minMenuWidth = 320,
  maxMenuHeight = 384,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [menuPos, setMenuPos] = React.useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const selected = React.useMemo(
    () => options.find((o) => String(o.value) === String(value)) || null,
    [options, value]
  );
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  React.useEffect(() => {
    if (open) {
      setActiveIdx(() =>
        Math.max(
          0,
          filtered.findIndex((o) => String(o.value) === String(value))
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updatePos = React.useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const desiredWidth = Math.max(
      r.width,
      Math.min(minMenuWidth, vw - margin * 2)
    );
    const maxAllowedWidth = vw - margin * 2;
    const width = Math.min(Math.max(desiredWidth, r.width), maxAllowedWidth);
    const left = Math.max(margin, Math.min(r.left, vw - width - margin));
    setMenuPos({ top: r.bottom, left, width });
  }, [minMenuWidth]);

  React.useEffect(() => {
    if (!open) return;
    updatePos();
    const on = () => updatePos();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
    };
  }, [open, updatePos]);

  React.useEffect(() => {
    function onDocDown(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, []);

  const commit = (opt: SearchOption | undefined) => {
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Input
        ref={inputRef}
        disabled={disabled}
        value={open ? query : selected?.label ?? ""}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          updatePos();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActiveIdx((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            commit(filtered[activeIdx]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            setQuery("");
          }
        }}
        className={cn("pr-7", disabled && "opacity-60")}
      />
      <button
        type="button"
        aria-label="toggle"
        disabled={disabled}
        className={cn(
          "absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 flex items-center justify-center",
          disabled && "opacity-60"
        )}
        onClick={() => {
          setOpen((o) => {
            const n = !o;
            if (n) updatePos();
            return n;
          });
        }}
      >
        <span aria-hidden>▾</span>
      </button>
      {open &&
        menuPos &&
        createPortal(
          <div
            className="z-[1000] rounded-md border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 overflow-auto"
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              width: menuPos.width,
              maxHeight: maxMenuHeight,
            }}
          >
            {filtered.length ? (
              <ul className="py-1 text-sm">
                {filtered.map((opt, idx) => (
                  <li
                    key={String(opt.value)}
                    className={cn(
                      "px-2 py-1.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800",
                      idx === activeIdx && "bg-slate-100 dark:bg-slate-800",
                      String(opt.value) === String(value) && "font-medium"
                    )}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(opt);
                    }}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    {opt.label}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-2 py-2 text-sm text-slate-500">該当なし</div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
