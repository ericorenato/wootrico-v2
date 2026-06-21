import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Keys from './pages/Keys';
import Events from './pages/Events';
import WebhookKeys from './pages/WebhookKeys';

function Spinner() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="h-6 w-6 rounded-full border-2 border-white/20 border-t-white animate-spin" />
    </div>
  );
}

function Protected({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (bare) {
    if (user) return <Navigate to="/" replace />;
    return <>{children}</>;
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <Protected bare>
                <Login />
              </Protected>
            }
          />
          <Route
            path="/"
            element={
              <Protected>
                <Keys />
              </Protected>
            }
          />
          <Route
            path="/events"
            element={
              <Protected>
                <Events />
              </Protected>
            }
          />
          <Route
            path="/webhook-keys"
            element={
              <Protected>
                <WebhookKeys />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
