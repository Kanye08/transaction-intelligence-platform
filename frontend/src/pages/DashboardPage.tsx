import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { api, ApiError } from '../api/client';
import type { Account, DashboardSummary } from '../api/types';
import { Amount, Card, EmptyState, ErrorState, formatDate, Spinner, StatusBadge } from '../components/ui';

const RANGES = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '180', label: 'Last 6 months', days: 180 },
  { key: 'all', label: 'All time', days: null },
] as const;

/** Chart palette: one hue family, distinguishable without relying on colour alone. */
const BAR_COLOURS = ['#0f5132', '#166b45', '#1f8557', '#2a9d6a', '#45b37f', '#6bc598', '#93d7b2'];

function rangeToDates(days: number | null): { dateFrom?: string; dateTo?: string } {
  if (days === null) return {};
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { dateFrom: from.toISOString(), dateTo: to.toISOString() };
}

export function DashboardPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('90');
  const [accountId, setAccountId] = useState<string>('');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedRange = RANGES.find((entry) => entry.key === range) ?? RANGES[1];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.dashboard({
        ...rangeToDates(selectedRange.days),
        accountId: accountId || undefined,
      });
      setSummary(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load the dashboard');
    } finally {
      setLoading(false);
    }
  }, [selectedRange.days, accountId]);

  useEffect(() => {
    api.accounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(
    () =>
      (summary?.spendingByCategory ?? []).slice(0, 7).map((row) => ({
        name: row.label,
        value: Number(row.amountMinor) / 100,
        formatted: row.formattedAmount,
        percentage: row.percentage,
      })),
    [summary],
  );

  const statusEntries = Object.entries(summary?.classificationStatus ?? {});
  const totalClassified = statusEntries.reduce((total, [, count]) => total + count, 0);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">
            {selectedRange.label}
            {accountId && accounts.length > 0
              ? ` · ${accounts.find((account) => account.id === accountId)?.name ?? ''}`
              : ' · all accounts'}
          </p>
        </div>
        <div className="filters">
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} · {account.bankName}
              </option>
            ))}
          </select>
          <div className="segmented" role="group" aria-label="Date range">
            {RANGES.map((entry) => (
              <button
                key={entry.key}
                type="button"
                className={entry.key === range ? 'is-active' : ''}
                onClick={() => setRange(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {loading && <Spinner label="Loading dashboard" />}
      {!loading && error && <ErrorState message={error} onRetry={() => void load()} />}

      {!loading && !error && summary && (
        <>
          <div className="metrics">
            <article className="metric">
              <span className="metric__label">Total inflows</span>
              <strong className="metric__value metric__value--in">{summary.totals.inflow.formattedAmount}</strong>
            </article>
            <article className="metric">
              <span className="metric__label">Total outflows</span>
              <strong className="metric__value metric__value--out">{summary.totals.outflow.formattedAmount}</strong>
            </article>
            <article className="metric">
              <span className="metric__label">Net cash flow</span>
              <strong
                className={`metric__value ${
                  summary.totals.net.amount.startsWith('-') ? 'metric__value--out' : 'metric__value--in'
                }`}
              >
                {summary.totals.net.formattedAmount}
              </strong>
            </article>
            <article className="metric">
              <span className="metric__label">Transactions</span>
              <strong className="metric__value">{summary.totals.transactionCount.toLocaleString()}</strong>
            </article>
            <article className="metric metric--alert">
              <span className="metric__label">Needs review</span>
              <strong className="metric__value">{summary.review.openFlags.toLocaleString()}</strong>
              <Link className="metric__link" to="/review">
                Open review queue →
              </Link>
            </article>
          </div>

          <div className="grid grid--2">
            <Card title="Spending by category">
              {chartData.length === 0 ? (
                <EmptyState title="No spending in this period" hint="Try a wider date range." />
              ) : (
                <div className="chart">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fontSize: 12, fill: 'var(--muted)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(15,81,50,0.06)' }}
                        formatter={(_value, _name, item) => [
                          `${item.payload.formatted} (${item.payload.percentage}%)`,
                          'Spend',
                        ]}
                      />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                        {chartData.map((entry, index) => (
                          <Cell key={entry.name} fill={BAR_COLOURS[index % BAR_COLOURS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card title="Classification status">
              {totalClassified === 0 ? (
                <EmptyState title="Nothing classified yet" />
              ) : (
                <ul className="statuslist">
                  {statusEntries
                    .sort(([, a], [, b]) => b - a)
                    .map(([status, count]) => (
                      <li key={status}>
                        <StatusBadge status={status as never} />
                        <span className="statuslist__bar">
                          <span style={{ width: `${(count / totalClassified) * 100}%` }} />
                        </span>
                        <span className="statuslist__count">{count.toLocaleString()}</span>
                      </li>
                    ))}
                </ul>
              )}

              {Object.keys(summary.review.byRule).length > 0 && (
                <>
                  <h3 className="card__subtitle">Open flags by rule</h3>
                  <ul className="rulelist">
                    {Object.entries(summary.review.byRule).map(([rule, count]) => (
                      <li key={rule}>
                        <Link to={`/review?rule=${rule}`}>{rule.replace(/_/g, ' ').toLowerCase()}</Link>
                        <span>{count}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          </div>

          <Card
            title="Recent activity"
            action={
              <Link className="btn btn--ghost btn--sm" to="/transactions">
                View all transactions
              </Link>
            }
          >
            {summary.recentTransactions.length === 0 ? (
              <EmptyState title="No transactions in this period" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.recentTransactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td className="nowrap">{formatDate(transaction.transactionDate)}</td>
                      <td>
                        <Link to={`/transactions?focus=${transaction.id}`}>{transaction.description}</Link>
                        {transaction.merchant && <span className="muted"> · {transaction.merchant}</span>}
                      </td>
                      <td>{transaction.categoryLabel ?? <span className="muted">—</span>}</td>
                      <td>
                        <StatusBadge status={transaction.classificationStatus} />
                      </td>
                      <td className="right">
                        <Amount value={transaction.formattedAmount} direction={transaction.direction} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
