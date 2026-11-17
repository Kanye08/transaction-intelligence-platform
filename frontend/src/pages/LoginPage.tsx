import { useState } from 'react';
import type { FormEvent } from 'react';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setFieldErrors([]);

    // Client-side checks mirror the API's, so the obvious mistakes are caught
    // without a round trip; the API remains the authority.
    if (!email.includes('@')) {
      setFieldErrors(['Enter a valid email address']);
      return;
    }
    if (password.length < 8) {
      setFieldErrors(['Password must be at least 8 characters']);
      return;
    }

    setSubmitting(true);
    try {
      await login(email, password);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.validationErrors ?? []);
      } else {
        setError('Unexpected error. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const fillDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Password123!');
    setError(null);
    setFieldErrors([]);
  };

  return (
    <div className="login">
      <div className="login__panel">
        <div className="login__brand">
          <span className="login__mark">S</span>
          <div>
            <h1>Transaction Intelligence</h1>
            <p className="muted">Sycamore Capital</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ada@lagosfoods.ng"
            disabled={submitting}
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            disabled={submitting}
          />

          {fieldErrors.length > 0 && (
            <ul className="form-errors" role="alert">
              {fieldErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="login__demo">
          <p className="muted">Demo organisations</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => fillDemo('ada@lagosfoods.ng')}>
            Lagos Foods Ltd
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => fillDemo('bola@abujalogistics.ng')}
          >
            Abuja Logistics Ltd
          </button>
        </div>
      </div>
    </div>
  );
}
