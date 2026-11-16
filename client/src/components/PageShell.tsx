import React, { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AccountMenu } from '../auth'
import { APP_NAME, LOGO_URL } from '../lib/brand'
import { Icon } from './ui'

/** Frame for full pages outside the editor: brand, a way back to the files, and the account menu. */
export function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => { document.title = `${title} – ${APP_NAME}` }, [title])
  return (
    <div className="page">
      <header className="dash-top">
        <Link to="/" className="brand"><img src={LOGO_URL} alt="" /><b>{APP_NAME}</b></Link>
        <Link to="/" className="crumb hide-narrow"><Icon name="file" size={15} />My documents</Link>
        <div style={{ flex: 1 }} />
        <AccountMenu />
      </header>
      <main className="page-main"><div className="page-inner">{children}</div></main>
    </div>
  )
}

/** A value shown once (temporary password, invite link) with a copy button. */
export function Secret({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)
  const copy = () => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600) }, () => {})
  return (
    <div className="secret">
      <span>{value}</span>
      <button type="button" className="btn" style={{ height: 28 }} onClick={copy}><Icon name={copied ? 'check' : 'copy'} size={14} />{copied ? 'Copied' : 'Copy'}</button>
    </div>
  )
}
