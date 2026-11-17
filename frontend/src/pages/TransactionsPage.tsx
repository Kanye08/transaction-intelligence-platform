import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api, ApiError } from '../api/client';
import type { Account, Transaction, TransactionPage } from '../api/types';
import { CATEGORIES, CATEGORY_LABELS } from '../api/types';
import { TransactionDetail } from '../components/TransactionDetail';
import {
  Amount,
  Confidence,
  EmptyState,
  ErrorState,
  formatDate,
  Spinner,
  StatusBadge,
} from '../components/ui';

interface Filters {
  search: string;
  accountId: string;
  direction: string;
  category: string;
  classificationStatus: string;
  review: string;
  dateFrom: string;
  dateTo: string;
  amountMin: string;
  amountMax: string;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  accountId: '',
  direction: '',
  category: '',
  classificationStatus: '',
  review: '',
  dateFrom: '',
  dateTo: '',
  amountMin: '',
  amountMax: '',
};

const PAGE_SIZE = 25;

export function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [page, setPage] = useState<TransactionPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cursor pagination: the stack holds the cursor that opened each page, so
  // "previous" is a pop rather than a second round of queries.
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const [selected, setSelected] = useState<string | null>(searchParams.get('focus'));

  useEffect(() => {
    api.accounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  // Debounce free-text search so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search.trim()), 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const currentCursor = cursorStack[cursorStack.length - 1] ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.transactions({
        search: debouncedSearch || undefined,
        accountId: filters.accountId || undefined,
        direction: filters.direction || undefined,
        category: filters.category || undefined,
        classificationStatus: filters.classificationStatus || undefined,
        review: filters.review || undefined,
        dateFrom: filters.dateFrom ? new Date(filters.dateFrom).toISOString() : undefined,
        dateTo: filters.dateTo ? new Date(`${filters.dateTo}T23:59:59`).toISOString() : undefined,
        amountMin: filters.amountMin || undefined,
        amountMax: filters.amountMax || undefined,
        limit: PAGE_SIZE,
        cursor: currentCursor,
        includeTotal: true,
      });
      setPage(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load transactions');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filters, currentCursor]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setCursorStack([null]); // any filter change restarts pagination
  };

  const openDetail = (transaction: Transaction) => {
    setSelected(transaction.id);
    searchParams.set('focus', transaction.id);
    setSearchParams(searchParams, { replace: true });
  };

  const closeDetail = () => {
    setSelected(null);
    searchParams.delete('focus');
    setSearchParams(searchParams, { replace: true });
  };

  const activeFilterCount = Object.entries(filters).filter(([, value]) => value !== '').length;
  const pageNumber = cursorStack.length;

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Transactions</h1>
          <p className="muted">
            {page?.total !== undefined
              ? `${page.total.toLocaleString()} transaction${page.total === 1 ? '' : 's'}`
              : 'Browse, search and filter the ledger'}
            {activeFilterCount > 0 && ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} applied`}
          </p>
        </div>
      </header>

      <section className="filterbar">
        <input
          type="search"
          placeholder="Search description, merchant or reference…"
          value={filters.search}
          onChange={(event) => update({ search: event.target.value })}
          aria-label="Search transactions"
        />
        <select value={filters.accountId} onChange={(event) => update({ accountId: event.target.value })} aria-label="Account">
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <select value={filters.direction} onChange={(event) => update({ direction: event.target.value })} aria-label="Direction">
          <option value="">In and out</option>
          <option value="INFLOW">Money in</option>
          <option value="OUTFLOW">Money out</option>
        </select>
        <select value={filters.category} onChange={(event) => update({ category: event.target.value })} aria-label="Category">
          <option value="">All categories</option>
          {CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
        <select
          value={filters.classificationStatus}
          onChange={(event) => update({ classificationStatus: event.target.value })}
          aria-label="Classification status"
        >
          <option value="">Any status</option>
          <option value="CLASSIFIED">Classified</option>
          <option value="PROVISIONAL">Provisional</option>
          <option value="PENDING">Pending</option>
          <option value="FAILED_RETRYING">Retrying</option>
          <option value="MANUAL">Manually set</option>
        </select>
        <select value={filters.review} onChange={(event) => update({ review: event.target.value })} aria-label="Review state">
          <option value="">Any review state</option>
          <option value="OPEN">Needs review</option>
          <option value="FLAGGED">Ever flagged</option>
          <option value="CLEAR">No open flags</option>
        </select>
        <div className="filterbar__row">
          <label>
            From
            <input type="date" value={filters.dateFrom} onChange={(event) => update({ dateFrom: event.target.value })} />
          </label>
          <label>
            To
            <input type="date" value={filters.dateTo} onChange={(event) => update({ dateTo: event.target.value })} />
          </label>
          <label>
            Min ₦
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={filters.amountMin}
              onChange={(event) => update({ amountMin: event.target.value })}
            />
          </label>
          <label>
            Max ₦
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={filters.amountMax}
              onChange={(event) => update({ amountMax: event.target.value })}
            />
          </label>
          {activeFilterCount > 0 && (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setCursorStack([null]);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {loading && <Spinner label="Loading transactions" />}
      {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && page && page.data.length === 0 && (
        <EmptyState
          title="No transactions match these filters"
          hint={activeFilterCount > 0 ? 'Try clearing a filter or widening the date range.' : undefined}
        />
      )}

      {!loading && !error && page && page.data.length > 0 && (
        <div className="card">
          <table className="table table--hover">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Account</th>
                <th>Category</th>
                <th>Confidence</th>
                <th>Status</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {page.data.map((transaction) => (
                <tr
                  key={transaction.id}
                  onClick={() => openDetail(transaction)}
                  className={transaction.openFlagCount > 0 ? 'row--flagged' : ''}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') openDetail(transaction);
                  }}
                >
                  <td className="nowrap">{formatDate(transaction.transactionDate)}</td>
                  <td>
                    <span className="cell-title">{transaction.description}</span>
                    {transaction.merchant && <span className="muted"> · {transaction.merchant}</span>}
                    {transaction.openFlagCount > 0 && (
                      <span className="pill pill--alert" title="Needs review">
                        {transaction.openFlagCount} flag{transaction.openFlagCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                  <td className="nowrap muted">{transaction.accountName ?? '—'}</td>
                  <td>{transaction.classification.categoryLabel ?? <span className="muted">—</span>}</td>
                  <td>
                    <Confidence value={transaction.classification.confidence} />
                  </td>
                  <td>
                    <StatusBadge status={transaction.classification.status} />
                  </td>
                  <td className="right">
                    <Amount value={transaction.formattedAmount} direction={transaction.direction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <footer className="pagination">
            <span className="muted">
              Page {pageNumber}
              {page.total !== undefined ? ` · ${page.total.toLocaleString()} total` : ''}
            </span>
            <div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={cursorStack.length === 1}
                onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
              >
                ← Previous
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!page.pageInfo.hasMore}
                onClick={() => setCursorStack((stack) => [...stack, page.pageInfo.nextCursor])}
              >
                Next →
              </button>
            </div>
          </footer>
        </div>
      )}

      {selected && (
        <>
          <div className="scrim" onClick={closeDetail} aria-hidden="true" />
          <TransactionDetail transactionId={selected} onClose={closeDetail} onChanged={() => void load()} />
        </>
      )}
    </div>
  );
}
