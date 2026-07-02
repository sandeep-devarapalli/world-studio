import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren } from "react";

type PanelProps = PropsWithChildren<{
  title?: string;
  meta?: string;
  className?: string;
}>;

export function WSPanel({ title, meta, className = "", children }: PanelProps) {
  return (
    <section className={`ws-panel ${className}`.trim()}>
      {(title || meta) && (
        <header className="ws-panel-head">
          {title ? <div className="ws-head">{title}</div> : <span />}
          {meta ? <div className="ws-head-right">{meta}</div> : null}
        </header>
      )}
      <div className="ws-panel-body">{children}</div>
    </section>
  );
}

export function WSPill({
  active,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button className={`ws-pill ${active ? "on" : ""} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function WSButton({
  accent,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { accent?: boolean }) {
  return (
    <button className={`ws-btn ${accent ? "acc" : ""} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function WSChip({
  accent,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { accent?: boolean }) {
  return (
    <span className={`ws-chip ${accent ? "acc" : ""} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}

export function WSKey({
  active,
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { active?: boolean }) {
  return (
    <span className={`ws-key ${active ? "on" : ""} ${className}`.trim()} {...props}>
      {children}
    </span>
  );
}

export function WSSwitch({ on }: { on: boolean }) {
  return (
    <span className={`ws-switch ${on ? "on" : ""}`}>
      <span />
    </span>
  );
}

export function WSStatusBar({ items }: { items: Array<{ label: string; accent?: boolean }> }) {
  return (
    <footer className="ws-statusbar">
      {items.map((item) => (
        <span key={item.label} className={`ws-status-item ${item.accent ? "acc" : ""}`}>
          {item.label}
        </span>
      ))}
    </footer>
  );
}

export function WSControlsBar({
  controls
}: {
  controls: Array<{ keyName: string; label: string; active?: boolean }>;
}) {
  return (
    <div className="ws-panel ws-ctrlbar">
      {controls.map((control) => (
        <span className="ws-ctrl" key={`${control.keyName}-${control.label}`}>
          <WSKey active={control.active}>{control.keyName}</WSKey>
          <span className="ws-ctrl-label">{control.label}</span>
        </span>
      ))}
    </div>
  );
}

export function WSWordmark({ context }: { context: string }) {
  return (
    <div className="ws-panel ws-wordmark">
      <div className="ws-logo-glyph">
        <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
          <circle cx="15" cy="15" r="10.5" fill="none" stroke="var(--acc)" strokeWidth="1.5" />
          <path d="M8 17.5L15 7l7 10.5-7 5.5z" fill="none" stroke="var(--ink)" strokeWidth="1.2" />
        </svg>
      </div>
      <div>
        <div className="ws-logo-name">World Studio</div>
        <div className="ws-logo-sub">{context}</div>
      </div>
    </div>
  );
}

