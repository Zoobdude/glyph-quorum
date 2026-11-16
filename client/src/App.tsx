import React, { Suspense, lazy } from 'react'
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
import { AuthProvider, AuthPage, nextPath, useAuth } from './auth'
import { Dashboard } from './pages/Dashboard'
import { Setup } from './pages/Setup'
import { Toasts } from './components/ui'

// Monaco and pdf.js are large — load them only when a document is opened,
// so signing in and browsing files stay fast.
const EditorPage = lazy(() => import('./pages/EditorPage'))
// Used rarely, so kept out of the main bundle as well.
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })))
const References = lazy(() => import('./pages/References').then(m => ({ default: m.References })))

const Loading = () => <div className="center-fill"><div className="spinner" /></div>

/** Routes for signed-in users. Anyone else is sent to sign in, then brought back to where they were going. */
function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()
  if (user === undefined) return <Loading />
  if (!user) {
    const here = location.pathname + location.search
    return <Navigate to={here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`} replace />
  }
  return <Outlet />
}

/** Sign-in and sign-up pages. Someone already signed in is passed straight through to their destination. */
function GuestOnly() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  if (user === undefined) return <Loading />
  if (user) return <Navigate to={nextPath(params) ?? '/'} replace />
  return <Outlet />
}

/** Admin centre gate. The server enforces this too; here it just avoids showing a page that cannot load. */
function RequireAdmin() {
  const { user } = useAuth()
  return user?.role === 'admin' ? <Outlet /> : <NotFound />
}

/** A brand-new server shows the setup wizard on every URL until its first administrator exists. */
function Pages() {
  const { setupRequired, user } = useAuth()
  if (setupRequired && user !== undefined) return <Setup />
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/d/:docId" element={<Suspense fallback={<Loading />}><EditorPage /></Suspense>} />
        <Route path="/references" element={<Suspense fallback={<Loading />}><References /></Suspense>} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<Suspense fallback={<Loading />}><Admin /></Suspense>} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

function NotFound() {
  return (
    <div className="center-fill">
      <h1 style={{ fontSize: 20, color: 'var(--text)' }}>Page not found</h1>
      <p>That link does not point to anything on this server.</p>
      <Link to="/" className="btn btn-primary">Go to my documents</Link>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Pages />
        <Toasts />
      </AuthProvider>
    </BrowserRouter>
  )
}
