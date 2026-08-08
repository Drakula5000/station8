import { docTypeLabel } from '../documentKinds'

export function AccessGate({
  loading = false,
  authConfigured = true,
  setupAllowed = false,
  requiresSetup = false,
  backendOffline = false,
  authBusy = false,
  authError = '',
  loginPassword = '',
  ownerPassword = '',
  route,
  onLoginPasswordChange,
  onOwnerPasswordChange,
  onSubmitLogin,
  onSubmitSetup,
}) {
  if (loading) {
    return (
      <div className="auth-shell s8-grid">
        <div className="auth-card auth-card-loading">
          <div className="auth-kicker">Station 8</div>
          <div className="auth-title">Loading access state…</div>
        </div>
      </div>
    )
  }

  if (backendOffline) {
    return (
      <div className="auth-shell s8-grid">
        <div className="auth-card">
          <div className="auth-kicker">Station 8</div>
          <h1 className="auth-title">Backend offline</h1>
          <p className="auth-copy">
            The Station 8 backend isn't responding at <code>localhost:5001</code>.
            Make sure <code>dev.command</code> is running, then reload this page.
          </p>
          <p className="auth-copy" style={{ marginTop: '0.625rem', fontSize: '0.75rem', opacity: 0.7 }}>
            If it keeps failing, open <code>data/server.log</code> to see what crashed.
          </p>
          <button
            className="auth-submit"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }

  const directLabel = route?.doc ? `${docTypeLabel(route.doc.type)} link` : 'Workspace'
  const allowSetup = requiresSetup && setupAllowed
  const configMissing = !authConfigured && !setupAllowed

  return (
    <div className="auth-shell s8-grid">
      <div className="auth-card">
        <div className="auth-kicker">Station 8</div>
        <h1 className="auth-title">{allowSetup ? 'Set up access' : configMissing ? 'Access offline' : 'Enter the workspace'}</h1>
        <p className="auth-copy">
          {allowSetup
            ? 'Create the owner password. Visitor access passwords are managed from the owner view after setup.'
            : configMissing
            ? 'Station 8 access is not configured on the server. The owner needs to set OWNER_PASSWORD on the backend.'
            : `${directLabel} is protected. Enter either the owner password or a visitor access password to continue.`}
        </p>

        {allowSetup ? (
          <div className="auth-form">
            <label className="auth-label">
              <span>Owner password</span>
              <input
                type="password"
                value={ownerPassword}
                onChange={(e) => onOwnerPasswordChange(e.target.value)}
                placeholder="At least 6 characters"
              />
            </label>
            <button className="auth-submit" onClick={onSubmitSetup} disabled={authBusy || ownerPassword.length < 6} type="button">
              {authBusy ? 'Setting up…' : 'Save passwords'}
            </button>
          </div>
        ) : !configMissing ? (
          <div className="auth-form">
            <label className="auth-label">
              <span>Password</span>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => onLoginPasswordChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSubmitLogin() }}
                placeholder="Owner or visitor access password"
              />
            </label>
            <button className="auth-submit" onClick={onSubmitLogin} disabled={authBusy || !loginPassword.trim()} type="button">
              {authBusy ? 'Entering…' : 'Enter Station 8'}
            </button>
          </div>
        ) : null}

        {authError && <div className="auth-error">{authError}</div>}
      </div>
    </div>
  )
}

