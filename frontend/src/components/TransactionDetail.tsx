import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '../api/client';
import type {
  Category,
  ClassificationHistoryEntry,
  Transaction,
} from '../api/types';
import { CATEGORIES, CATEGORY_LABELS, RULE_LABELS } from '../api/types';
import {
  Amount,
  Confidence,
  FlagStatusBadge,
  formatDateTime,
  SeverityBadge,
  Spinner,
  StatusBadge,
} from './ui';

interface Props {
  transactionId: string;
  onClose: () => void;
  /** Called after any change, so the list behind the panel can refresh. */
  onChanged: () => void;
}

/**
 * Everything known about one transaction: the money, the classification, why
 * it was flagged, and the full decision history - plus the two actions a
 * reviewer actually needs (correct the category, ask for reclassification).
 */
export function TransactionDetail({ transactionId, onClose, onChanged }: Props) {
  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [history, setHistory] = useState<ClassificationHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [category, setCategory] = useState<Category | ''>('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, events] = await Promise.all([
        api.transaction(transactionId),
        api.classificationHistory(transactionId),
      ]);
      setTransaction(detail);
      setHistory(events);
      setCategory(detail.classification.category ?? '');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load this transaction');
    } finally {
      setLoading(false);
    }
  }, [transactionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!category || !transaction) return;
    if (category === transaction.classification.category) {
      setFeedback({ tone: 'error', message: 'That is already the current category.' });
      return;
    }

    setSaving(true);
    setFeedback(null);
    try {
      await api.correctClassification(transactionId, category, reason || undefined);
      setFeedback({ tone: 'ok', message: 'Category updated and recorded in the audit trail.' });
      setReason('');
      await load();
      onChanged();
    } catch (caught) {
      setFeedback({
        tone: 'error',
        message: caught instanceof ApiError ? caught.message : 'Could not save the correction',
      });
    } finally {
      setSaving(false);
    }
  };

  const reclassify = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      await api.reclassify(transactionId);
      setFeedback({
        tone: 'ok',
        message: 'Queued for reclassification. A manual category is never overwritten.',
      });
      onChanged();
    } catch (caught) {
      setFeedback({
        tone: 'error',
        message: caught instanceof ApiError ? caught.message : 'Could not queue reclassification',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="drawer" role="dialog" aria-modal="true" aria-label="Transaction detail">
      <header className="drawer__header">
        <h2>Transaction detail</h2>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="drawer__body">
        {loading && <Spinner label="Loading transaction" />}
        {!loading && error && <p className="form-error">{error}</p>}

        {!loading && transaction && (
          <>
            <div className="drawer__amount">
              <Amount value={transaction.formattedAmount} direction={transaction.direction} />
              <span className="muted">
                {transaction.direction === 'INFLOW' ? 'Money in' : 'Money out'} ·{' '}
                {formatDateTime(transaction.transactionDate)}
              </span>
            </div>

            <dl className="facts">
              <div>
                <dt>Description</dt>
                <dd>{transaction.description}</dd>
              </div>
              <div>
                <dt>Merchant</dt>
                <dd>{transaction.merchant ?? '—'}</dd>
              </div>
              <div>
                <dt>Account</dt>
                <dd>{transaction.accountName ?? transaction.accountId}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd className="mono">{transaction.externalReference}</dd>
              </div>
              <div>
                <dt>Exact amount</dt>
                <dd className="mono">
                  {transaction.amount} {transaction.currency} ({transaction.amountMinor} kobo)
                </dd>
              </div>
            </dl>

            <section className="drawer__section">
              <h3>Classification</h3>
              <div className="classification">
                <div>
                  <span className="muted">Current</span>
                  <strong>
                    {transaction.classification.categoryLabel ?? 'Not yet classified'}
                  </strong>
                </div>
                <div>
                  <span className="muted">Status</span>
                  <StatusBadge status={transaction.classification.status} />
                </div>
                <div>
                  <span className="muted">Confidence</span>
                  <Confidence value={transaction.classification.confidence} />
                </div>
                <div>
                  <span className="muted">Decided by</span>
                  <strong>
                    {transaction.classification.source ?? '—'}
                    {transaction.classification.provider ? ` · ${transaction.classification.provider}` : ''}
                  </strong>
                </div>
                {transaction.classification.originalCategory &&
                  transaction.classification.originalCategory !== transaction.classification.category && (
                    <div>
                      <span className="muted">Originally</span>
                      <strong>{CATEGORY_LABELS[transaction.classification.originalCategory]}</strong>
                    </div>
                  )}
              </div>
            </section>

            {transaction.reviewFlags.length > 0 && (
              <section className="drawer__section">
                <h3>Why this was flagged</h3>
                <ul className="flaglist">
                  {transaction.reviewFlags.map((flag) => (
                    <li key={flag.id}>
                      <div className="flaglist__head">
                        <strong>{RULE_LABELS[flag.rule]}</strong>
                        <SeverityBadge severity={flag.severity} />
                        <FlagStatusBadge status={flag.status} />
                      </div>
                      <p>{flag.explanation}</p>
                      {flag.resolvedBy && (
                        <p className="muted">
                          Closed by {flag.resolvedBy}
                          {flag.resolvedAt ? ` on ${formatDateTime(flag.resolvedAt)}` : ''}
                          {flag.resolutionNote ? ` — “${flag.resolutionNote}”` : ''}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="drawer__section">
              <h3>Correct the category</h3>
              <div className="field-row">
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value as Category)}
                  aria-label="Category"
                  disabled={saving}
                >
                  <option value="">Choose a category…</option>
                  {CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {CATEGORY_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                placeholder="Why is this the right category? (optional, stored in the audit trail)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={saving}
              />
              <div className="field-row">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => void save()}
                  disabled={saving || !category}
                >
                  {saving ? 'Saving…' : 'Save correction'}
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => void reclassify()}
                  disabled={saving}
                  title="Queue this transaction for the classifier again"
                >
                  Reclassify
                </button>
              </div>
              {feedback && (
                <p className={feedback.tone === 'ok' ? 'form-ok' : 'form-error'} role="status">
                  {feedback.message}
                </p>
              )}
            </section>

            <section className="drawer__section">
              <h3>Decision history</h3>
              {history.length === 0 ? (
                <p className="muted">No classification decisions recorded yet.</p>
              ) : (
                <ol className="timeline">
                  {history.map((event) => (
                    <li key={event.id}>
                      <div className="timeline__head">
                        <strong>
                          {event.previousCategoryLabel
                            ? `${event.previousCategoryLabel} → ${event.newCategoryLabel}`
                            : event.newCategoryLabel}
                        </strong>
                        <span className={`badge badge--src-${event.source.toLowerCase()}`}>{event.source}</span>
                      </div>
                      <p className="muted">
                        {formatDateTime(event.createdAt)}
                        {event.actor ? ` · ${event.actor}` : ''}
                        {event.provider ? ` · ${event.provider}` : ''}
                        {event.confidence !== null ? ` · ${Math.round(event.confidence * 100)}% confidence` : ''}
                      </p>
                      {event.reason && <p className="timeline__reason">{event.reason}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
