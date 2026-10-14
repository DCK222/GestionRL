"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X, ArrowUpRight, FileQuestion } from "lucide-react";
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Stat({
  label,
  value,
  detail,
  icon,
  accent = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  accent?: boolean;
}) {
  return (
    <article className={"stat " + (accent ? "accent" : "")}>
      <div className="stat-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
export function Empty({
  title = "Todavía no hay registros",
  text,
  action,
}: {
  title?: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <FileQuestion size={32} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar">
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function SectionTitle({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
export function LinkCard({
  title,
  text,
  icon,
  onClick,
}: {
  title: string;
  text: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="link-card" onClick={onClick}>
      <div className="card-icon">{icon}</div>
      <ArrowUpRight className="card-arrow" size={20} />
      <h3>{title}</h3>
      <p>{text}</p>
      <span>
        Abrir sección <span>→</span>
      </span>
    </button>
  );
}
