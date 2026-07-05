import type { ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren, ReactNode } from "react";

const wsIcons = {
  orbit: <path d="M10 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M10 10m-8.2 0a8.2 3.4 0 1 0 16.4 0a8.2 3.4 0 1 0-16.4 0" />,
  brush: <path d="M3 17c2.6-.4 3.2-1.6 4.4-2.8L14 7.6l-1.6-1.6-6.6 6.6C4.6 13.8 3.4 14.4 3 17zM13.5 4.9l1.6-1.6 1.6 1.6-1.6 1.6z" />,
  rect: <path d="M3.5 5.5h13v9h-13z" strokeDasharray="2.5 2" />,
  crop: <path d="M5.5 1.5v13h13M1.5 5.5h13v13" />,
  move: <path d="M10 2v16M2 10h16M10 2l-2.5 2.5M10 2l2.5 2.5M10 18l-2.5-2.5M10 18l2.5-2.5M2 10l2.5-2.5M2 10l2.5 2.5M18 10l-2.5-2.5M18 10l-2.5 2.5" />,
  ruler: <path d="M2 14L14 2l4 4L6 18zM6.5 9.5l1.6 1.6M9.5 6.5l1.6 1.6M12.5 3.5l1.6 1.6" />,
  undo: <path d="M4 8.5h8.5a3.5 3.5 0 110 7H9M4 8.5L7 5.5M4 8.5l3 3" />,
  select: <path d="M5 3l12 7-5.2 1.6L9 17z" />,
  spawn: <path d="M10 2l7 4v8l-7 4-7-4V6zM10 10l7-4M10 10L3 6M10 10v8" />,
  agent: <path d="M10 3a3 3 0 110 6 3 3 0 010-6zM5 17c0-2.8 2.2-5 5-5s5 2.2 5 5M10 1v2" />,
  camera: <path d="M3 6h4l1.5-2h3L13 6h4v9H3zM10 13.4a2.9 2.9 0 100-5.8 2.9 2.9 0 000 5.8z" />,
  layers: <path d="M10 2l8 4-8 4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4" />,
  play: <path d="M6 4l10 6-10 6z" fill="currentColor" stroke="none" />,
  pause: <path d="M6 4h2.6v12H6zM11.4 4H14v12h-2.6z" fill="currentColor" stroke="none" />,
  skip: <path d="M4 4l7 6-7 6zM13 4h2.4v12H13z" fill="currentColor" stroke="none" />,
  eye: <path d="M2 10s3-5 8-5 8 5 8 5-3 5-8 5-8-5-8-5zM10 12.2a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4z" />,
  chev: <path d="M7 4.5L13 10l-6 5.5" />,
  chevD: <path d="M4.5 7L10 13l5.5-6" />,
  lidar: <path d="M10 10m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M10 10m-4.6 0a4.6 4.6 0 1 0 9.2 0M10 10m-7.6 0a7.6 7.6 0 1 0 15.2 0" />,
  imu: <path d="M4 10a6 6 0 0112 0M2 10a8 8 0 0116 0M10 10l3.5-3.5M10 10.2a.2.2 0 100-.4.2.2 0 000 .4z" />,
  mouseL: (
    <g>
      <path d="M10 2.75V9H5.75V7A4.25 4.25 0 0 1 10 2.75z" fill="currentColor" stroke="none" />
      <rect x="5.75" y="2.75" width="8.5" height="14.5" rx="4.25" />
      <path d="M10 2.75V9M5.75 9h8.5" />
    </g>
  ),
  mouseR: (
    <g>
      <path d="M10 2.75A4.25 4.25 0 0 1 14.25 7v2H10z" fill="currentColor" stroke="none" />
      <rect x="5.75" y="2.75" width="8.5" height="14.5" rx="4.25" />
      <path d="M10 2.75V9M5.75 9h8.5" />
    </g>
  ),
  wheel: (
    <g>
      <rect x="5.75" y="2.75" width="8.5" height="14.5" rx="4.25" />
      <rect x="9.1" y="5.2" width="1.8" height="4.4" rx="0.9" fill="currentColor" stroke="none" />
    </g>
  )
} satisfies Record<string, ReactNode>;

export type WSIconName = keyof typeof wsIcons;

export function WSIcon({ name, size = 19 }: { name: WSIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {wsIcons[name]}
    </svg>
  );
}

type PanelProps = PropsWithChildren<{
  title?: string;
  meta?: string;
  className?: string;
  pad?: boolean;
}> &
  HTMLAttributes<HTMLElement>;

export function WSPanel({ title, meta, className = "", pad = true, children, ...props }: PanelProps) {
  return (
    <section className={`ws-panel ${className}`.trim()} {...props}>
      {(title || meta) && (
        <header className="ws-panel-head">
          {title ? <div className="ws-head">{title}</div> : <span />}
          {meta ? <div className="ws-head-right">{meta}</div> : null}
        </header>
      )}
      <div className="ws-panel-body" style={pad ? undefined : { padding: 0 }}>
        {children}
      </div>
    </section>
  );
}

export function WSDot({ color = "var(--acc)", pulse }: { color?: string; pulse?: boolean }) {
  return <span className={`ws-dot ${pulse ? "pulse" : ""}`.trim()} style={{ background: color }} />;
}

export function WSSliderRow({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div className="ws-slider-row">
      <span className="ws-head">{label}</span>
      <span className="ws-track">
        <span className="ws-fill" style={{ width: `${pct}%` }} />
        <span className="ws-thumb" style={{ left: `${pct}%` }} />
      </span>
      <span className="ws-mono-val">{value}</span>
    </div>
  );
}

export function WSRamp({ from, to, label }: { from: number; to: number; label: string }) {
  return (
    <div>
      <div className="ws-ramp" />
      <div className="ws-ramp-vals">
        <span>{from.toFixed(4)}</span>
        <span>{((from + to) / 2).toFixed(4)}</span>
        <span>{to.toFixed(4)}</span>
      </div>
      <div className="ws-ramp-label">
        <span className="ws-ramp-note">{label} · 1–99 pct stretch</span>
      </div>
    </div>
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
  controls: Array<{ keyName?: string; glyph?: WSIconName; label: string; active?: boolean }>;
}) {
  return (
    <div className="ws-panel ws-ctrlbar">
      {controls.map((control) => (
        <span className="ws-ctrl" key={`${control.glyph ?? control.keyName}-${control.label}`}>
          <WSKey active={control.active} className={control.glyph ? "ws-key-mouse" : ""}>
            {control.glyph ? <WSIcon name={control.glyph} size={14} /> : control.keyName}
          </WSKey>
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
