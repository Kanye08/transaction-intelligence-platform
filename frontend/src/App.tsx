import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './auth/AuthContext';
import { Spinner } from './components/ui';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { ReviewPage } from './pages/ReviewPage';
import { TransactionsPage } from './pages/TransactionsPage';

function Shell() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark">S</span>
          <div>
            <strong>Transaction Intelligence</strong>
            <span className="muted">{user.organisation.name}</span>
          </div>
        </div>

        <nav className="topbar__nav">
          <NavLink to="/dashboard">Dashboard</NavLink>
          <NavLink to="/transactions">Transactions</NavLink>
          <NavLink to="/review">Review</NavLink>
        </nav>

        <div className="topbar__user">
          <span>
            {user.name}
            <span className="muted"> · {user.role.toLowerCase()}</span>
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function Gate() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="boot">
        <Spinner label="Starting" />
      </div>
    );
  }

  return user ? <Shell /> : <LoginPage />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  );
}
