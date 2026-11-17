import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api, ApiError } from '../api/client';
import type { ReviewFlag, ReviewFlagPage, ReviewSummary } from '../api/types';
import { RULE_LABELS } from '../api/types';
import { TransactionDetail } from '../components/TransactionDetail';
import {
  Amount,
  Card,
  EmptyState,
  ErrorState,
  FlagStatusBadge,
  formatDate,
  formatDateTime,
  SeverityBadge,
  Spinner,
} from '../components/ui';

const PAGE_SIZE = 20;

export function ReviewPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState(searchParams.get('status') ?? 'OPEN');
  const [rule, setRule] = useState(searchParams.get('rule') ?? '');
  const [severity, setSeverity] = useState('');
  const [offset, setOffset] = useState(0);

  const [page, setPage] = useState<ReviewFlagPage | null>(null);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; message: string } | null>(null);
  const [confirming, setConfirming] = useState<{ flag: ReviewFlag; action: 'RESOLVE' | 'DISMISS' } | null>(
    null,
  );
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [flags, counts] = await Promise.all([
        api.reviewFlags({
          status: status || undefined,
          rule: rule || undefined,
          severity: severity || undefined,
          limit: PAGE_SIZE,
          offset,
        }),
        api.reviewSummary(),
      ]);
      setPage(flags);
      setSummary(counts);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the review queue');
    } finally {
      setLoading(false);
    }
  }, [status, rule, severity, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (rule) next.set('rule', rule);
    else next.delete('rule');
    if (status) next.set('status', status);
    else next.delete('status');
    setSearchParams(next, { replace: true });
    // searchParams is intentionally omitted: it would re-trigger on its own update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, status]);

  const closeFlag = async () => {
    if (!confirming) return;
    setBusyFlag(confirming.flag.id);
    setNotice(null);
    try {
      await api.resolveFlag(confirming.flag.id, confirming.action, note || undefined);
      setNotice({
        tone: 'ok',
        message:
          confirming.action === 'RESOLVE'
            ? 'Flag resolved and recorded against your name.'
            : 'Flag dismissed as a false positive.',
      });
      setConfirming(null);
      setNote('');
      await load();
    } catch (caught) {
      setNotice({
        tone: 'error',
        message: caught instanceof ApiError ? caught.message : 'Could not update the flag',
      });
    } finally {
      setBusyFlag(null);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Transaction review</h1>
          <p className="muted">
            {summary
              ? `${summary.open.toLocaleString()} open · ${summary.resolved.toLocaleString()} resolved · ${summary.dismissed.toLocaleString()} dismissed`
              : 'Transactions the system wants a person to look at'}
          </p>
        </div>
        <div className="filters">
          <select value={status} onChange={(event) => { setStatus(event.target.value); setOffset(0); }} aria-label="Flag status">
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="DISMISSED">Dismissed</option>
            <option value="">All</option>
          </select>
          <select value={rule} onChange={(event) => { setRule(event.target.value); setOffset(0); }} aria-label="Detection rule">
            <option value="">All rules</option>
            {Object.entries(RULE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select value={severity} onChange={(event) => { setSeverity(event.target.value); setOffset(0); }} aria-label="Severity">
            <option value="">Any severity</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>
      </header>

      {notice && (
        <p className={notice.tone === 'ok' ? 'form-ok' : 'form-error'} role="status">
          {notice.message}
        </p>
      )}

      {loading && <Spinner label="Loading review queue" />}
      {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && page && page.data.length === 0 && (
        <EmptyState
          title={status === 'OPEN' ? 'Nothing needs review' : 'No flags match these filters'}
          hint={status === 'OPEN' ? 'Every flagged transaction has been dealt with.' : undefined}
        />
      )}

      {!loading && !error && page && page.data.length > 0 && (
        <>
          <div className="flagcards">
            {page.data.map((flag) => (
              <Card key={flag.id}>
                <div className="flagcard__head">
                  <div>
                    <strong>{RULE_LABELS[flag.rule]}</strong>
                    <SeverityBadge severity={flag.severity} />
                    <FlagStatusBadge status={flag.status} />
                  </div>
                  <Amount
                    value={flag.transaction.formattedAmount}
                    direction={flag.transaction.direction}
                  />
                </div>

                <p className="flagcard__why">{flag.explanation}</p>

                <dl className="flagcard__facts">
                  <div>
                    <dt>Transaction</dt>
                    <dd>
                      {flag.transaction.description}
                      {flag.transaction.merchant ? ` · ${flag.transaction.merchant}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Date</dt>
                    <dd>{formatDate(flag.transaction.transactionDate)}</dd>
                  </div>
                  <div>
                    <dt>Account</dt>
                    <dd>{flag.transaction.accountName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Current category</dt>
                    <dd>{flag.transaction.category ?? 'Not classified'}</dd>
                  </div>
                </dl>

                {flag.status !== 'OPEN' && flag.resolvedBy && (
                  <p className="muted">
                    Closed by {flag.resolvedBy}
                    {flag.resolvedAt ? ` on ${formatDateTime(flag.resolvedAt)}` : ''}
                    {flag.resolutionNote ? ` — “${flag.resolutionNote}”` : ''}
                  </p>
                )}

                <div className="flagcard__actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setSelected(flag.transaction.id)}
                  >
                    Open transaction
                  </button>
                  {flag.status === 'OPEN' && (
                    <>
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        disabled={busyFlag === flag.id}
                        onClick={() => { setConfirming({ flag, action: 'RESOLVE' }); setNote(''); }}
                      >
                        Resolve
                      </button>
                      <button
                        type="button"
                        className="btn btn--sm"
                        disabled={busyFlag === flag.id}
                        onClick={() => { setConfirming({ flag, action: 'DISMISS' }); setNote(''); }}
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>

          <footer className="pagination">
            <span className="muted">
              Showing {page.offset + 1}–{Math.min(page.offset + page.limit, page.total)} of{' '}
              {page.total.toLocaleString()}
            </span>
            <div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={offset === 0}
                onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={page.offset + page.limit >= page.total}
                onClick={() => setOffset((value) => value + PAGE_SIZE)}
              >
                Next →
              </button>
            </div>
          </footer>
        </>
      )}

      {confirming && (
        <>
          <div className="scrim" onClick={() => setConfirming(null)} aria-hidden="true" />
          <div className="modal" role="dialog" aria-modal="true" aria-label="Confirm">
            <h2>{confirming.action === 'RESOLVE' ? 'Resolve this flag?' : 'Dismiss this flag?'}</h2>
            <p className="muted">
              {confirming.action === 'RESOLVE'
                ? 'Use this when the flag was valid and has been dealt with.'
                : 'Use this when the flag was a false positive. Both outcomes are recorded against your name.'}
            </p>
            <input
              type="text"
              placeholder="Add a note (optional)"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="modal__actions">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => void closeFlag()}
                disabled={busyFlag !== null}
              >
                {busyFlag ? 'Saving…' : confirming.action === 'RESOLVE' ? 'Resolve flag' : 'Dismiss flag'}
              </button>
            </div>
          </div>
        </>
      )}

      {selected && (
        <>
          <div className="scrim" onClick={() => setSelected(null)} aria-hidden="true" />
          <TransactionDetail
            transactionId={selected}
            onClose={() => setSelected(null)}
            onChanged={() => void load()}
          />
        </>
      )}
    </div>
  );
}
