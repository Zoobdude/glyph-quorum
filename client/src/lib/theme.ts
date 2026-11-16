import { useSyncExternalStore } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'gq-theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch { return 'system' }
}

let choice = read()
const resolve = (): Theme => (choice === 'system' ? (media.matches ? 'dark' : 'light') : choice)
let snapshot = { choice, theme: resolve() }

function apply(): void {
  snapshot = { choice, theme: resolve() }
  document.documentElement.dataset.theme = snapshot.theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', snapshot.theme === 'dark' ? '#181c25' : '#ffffff')
  listeners.forEach(l => l())
}

// Follow the operating system while set to "system", and stay in step with other tabs.
media.addEventListener('change', apply)
window.addEventListener('storage', e => { if (e.key === KEY) { choice = read(); apply() } })
apply()

export function setThemeChoice(next: ThemeChoice): void {
  choice = next
  try { next === 'system' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, next) } catch {}
  apply()
}

/** The user's preference and the theme currently showing. */
export function useTheme(): { choice: ThemeChoice; theme: Theme } {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => snapshot)
}
