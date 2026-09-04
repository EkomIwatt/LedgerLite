import { Suspense, lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { RequireAnonymous, RequireAuth } from './auth/routeGuards';
import { AppLayout } from './components/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SkeletonStack } from './components/feedback';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SignupPage } from './pages/SignupPage';

/**
 * The signed-in pages are loaded on demand.
 *
 * Recharts is by far the heaviest thing in the bundle and it is reachable only
 * from the dashboard, so someone arriving at /login has no business
 * downloading it. The auth screens stay in the entry chunk because they are
 * the first thing most visitors see.
 */
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const ExpensesPage = lazy(() =>
  import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })),
);
const BudgetsPage = lazy(() =>
  import('./pages/BudgetsPage').then((m) => ({ default: m.BudgetsPage })),
);

/** Holds the page's shape while its chunk arrives, so nothing jumps. */
function PageFallback() {
  return (
    <div className="panel" aria-busy="true">
      <SkeletonStack rows={6} height={26} />
    </div>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Signed out only. An authenticated visitor is sent onward to
                wherever they were originally trying to reach. */}
            <Route element={<RequireAnonymous />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
            </Route>

            {/* Everything below requires a session. */}
            <Route element={<RequireAuth />}>
              <Route element={<AppLayout />}>
                <Route
                  index
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <DashboardPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/expenses"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <ExpensesPage />
                    </Suspense>
                  }
                />
                <Route
                  path="/budgets"
                  element={
                    <Suspense fallback={<PageFallback />}>
                      <BudgetsPage />
                    </Suspense>
                  }
                />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
