import type { ReactNode } from 'react';

import type { ClassificationStatus, ReviewSeverity, ReviewStatus } from '../api/types';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <strong>Something went wrong</strong>
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn--sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<ClassificationStatus, string> = {
  PENDING: 'Pending',
  CLASSIFIED: 'Classified',
  PROVISIONAL: 'Provisional',
  FAILED_RETRYING: 'Retrying',
  MANUAL: 'Manual',
};

export function StatusBadge({ status }: { status: ClassificationStatus }) {
  return (
    <span className={`badge badge--${status.toLowerCase()}`} title={`Classification status: ${STATUS_LABELS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: ReviewSeverity }) {
  return <span className={`badge badge--sev-${severity.toLowerCase()}`}>{severity}</span>;
}

export function FlagStatusBadge({ status }: { status: ReviewStatus }) {
  return <span className={`badge badge--flag-${status.toLowerCase()}`}>{status.toLowerCase()}</span>;
}

export function Confidence({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">—</span>;
  const percent = Math.round(value * 100);
  const tone = percent >= 75 ? 'high' : percent >= 60 ? 'medium' : 'low';
  return (
    <span className={`confidence confidence--${tone}`} title={`${percent}% confidence`}>
      <span className="confidence__bar" style={{ width: `${percent}%` }} />
      <span className="confidence__value">{percent}%</span>
    </span>
  );
}

export function Amount({ value, direction }: { value: string; direction: 'INFLOW' | 'OUTFLOW' }) {
  return (
    <span className={`amount amount--${direction.toLowerCase()}`}>
      {direction === 'INFLOW' ? '+' : '−'}
      {value}
    </span>
  );
}

export function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && (
        <header className="card__header">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
