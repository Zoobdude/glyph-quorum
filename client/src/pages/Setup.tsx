import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type RegistrationMode, type User } from '../lib/api'
import { APP_NAME, LOGO_URL } from '../lib/brand'
import { useAuth } from '../auth'

export const REGISTRATION_CHOICES: { id: RegistrationMode; title: string; detail: string }[] = [
  { id: 'invite', title: 'Invite only', detail: 'People join with an invite link you create in the admin centre. Recommended.' },
  { id: 'open', title: 'Anyone can sign up', detail: 'Anybody who can reach this server can create an account.' },
  { id: 'closed', title: 'Closed', detail: 'Nobody can sign up. Administrators create every account.' },
]

/** First-run wizard: prove you control the server, create the administrator, choose who may join. */
export function Setup() {
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [serverName, setServerName] = useState(APP_NAME)
  const [registration, setRegistration] = useState<RegistrationMode>('invite')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [adopted, setAdopted] = useState(0)

  useEffect(() => { document.title = `Set up ${APP_NAME}` }, [])
  useEffect(() => setError(''), [step])

  const run = async (fn: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (step === 0) run(async () => { await api('/setup/verify', { body: { code } }); setStep(1) })
    else if (step === 1) {
      if (password !== confirm) { setError('The two passwords do not match'); return }
      setStep(2)
    } else if (step === 2) run(async () => {
      const r = await api<{ user: User; adopted: number }>('/setup', { body: { code, name, email, password, serverName, registration } })
      setAdopted(r.adopted)
      setStep(3)
    })
    else { navigate('/', { replace: true }); refresh() } // setup is complete and the session cookie is set: load the app
  }

  const titles = ['Welcome', 'Create the administrator', 'Server settings', 'All set']

  return (
    <div className="auth-page">
      <form className="auth-card wide" onSubmit={submit}>
        <div className="brand"><img src={LOGO_URL} alt="" /><b>{APP_NAME}</b></div>
        <div className="steps" aria-hidden="true">{[0, 1, 2, 3].map(i => <i key={i} className={i <= step ? 'done' : ''} />)}</div>
        <h1>{titles[step]}</h1>

        {step === 0 && <>
          <p className="sub">This server has not been set up yet. To prove you control it, enter the setup code printed in the server log.</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="field">
            <label className="label" htmlFor="code">Setup code</label>
            <input id="code" className="input mono" value={code} onChange={e => setCode(e.target.value)} placeholder="XXXX-XXXX" autoComplete="off" spellCheck={false} required autoFocus />
            <p className="hint" style={{ marginTop: 8, fontSize: 12 }}>
              With Docker: <code>docker compose logs</code>. The code appears in a box under “First-run setup”. If you set <code>SETUP_TOKEN</code>, use that value.
            </p>
          </div>
        </>}

        {step === 1 && <>
          <p className="sub">This account manages users, invites and settings. You can add more administrators later.</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="field">
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={60} required autoFocus />
          </div>
          <div className="field">
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} required />
          </div>
          <div className="field">
            <label className="label" htmlFor="confirm">Confirm password</label>
            <input id="confirm" className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} required />
          </div>
        </>}

        {step === 2 && <>
          <p className="sub">Both can be changed later in the admin centre.</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="field">
            <label className="label" htmlFor="server">Server name</label>
            <input id="server" className="input" value={serverName} onChange={e => setServerName(e.target.value)} maxLength={40} required autoFocus />
          </div>
          <div className="field" role="radiogroup" aria-label="Who can sign up">
            <span className="label">Who can sign up</span>
            {REGISTRATION_CHOICES.map(c => (
              <label key={c.id} className={`choice${registration === c.id ? ' selected' : ''}`}>
                <input type="radio" name="registration" checked={registration === c.id} onChange={() => setRegistration(c.id)} />
                <div><b>{c.title}</b><span>{c.detail}</span></div>
              </label>
            ))}
          </div>
        </>}

        {step === 3 && <>
          <p className="sub">
            {serverName} is ready and you are signed in as its administrator.
            {adopted > 0 && ` ${adopted} existing ${adopted === 1 ? 'room was' : 'rooms were'} moved into your documents.`}
          </p>
          <p className="hint" style={{ marginBottom: 18 }}>
            {registration === 'invite' ? 'Next: open the admin centre from your account menu to invite people.'
              : registration === 'closed' ? 'Next: open the admin centre from your account menu to create accounts.'
              : 'People can now create their own accounts from the sign-in page.'}
          </p>
        </>}

        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {(step === 1 || step === 2) && <button type="button" className="btn btn-lg" onClick={() => setStep(step - 1)} disabled={busy}>Back</button>}
          <button className="btn btn-primary btn-lg" style={{ flex: 1 }} disabled={busy}>
            {busy ? 'One moment…' : step === 2 ? 'Finish setup' : step === 3 ? 'Go to my documents' : 'Continue'}
          </button>
        </div>
      </form>
    </div>
  )
}
