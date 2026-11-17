import { useEffect, useState } from 'react';

interface Health {
  status: string;
  database: string;
  uptimeSeconds: number;
}

/**
 * Phase 1 shell: proves the frontend is wired to the real API.
 * Replaced by the login / dashboard / transactions / review screens.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <main className="shell">
      <h1>Sycamore Transaction Intelligence</h1>
      {error && <p className="error">API unreachable: {error}</p>}
      {!error && !health && <p>Checking API…</p>}
      {health && (
        <p>
          API status: <strong>{health.status}</strong> · database: <strong>{health.database}</strong>
        </p>
      )}
    </main>
  );
}
