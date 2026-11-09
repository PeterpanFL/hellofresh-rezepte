import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { supabase, supabaseConfigured } from './lib/supabase'
import Login from './pages/Login'
import RecipeList from './pages/RecipeList'
import RecipeDetail from './pages/RecipeDetail'
import Upload from './pages/Upload'
import WhatToCook from './pages/WhatToCook'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!supabaseConfigured) {
    return (
      <main className="mx-auto max-w-md p-6 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Supabase fehlt</h1>
        <p>Lege eine Datei <code>.env.local</code> nach dem Muster von <code>.env.example</code> an.</p>
      </main>
    )
  }
  if (session === undefined) return null
  if (!session) return <Login />

  return (
    <HashRouter>
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col pb-20 sm:pb-0">
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-stone-200 bg-stone-50/90 px-4 py-3 backdrop-blur">
          <NavLink to="/" className="font-semibold text-lime-900">Meine Rezepte</NavLink>
          <nav className="hidden gap-1 sm:flex">
            <Tab to="/">Rezepte</Tab>
            <Tab to="/kochen">Was koche ich?</Tab>
            <Tab to="/scannen">Hinzufügen</Tab>
          </nav>
          <button className="btn-ghost ml-auto" onClick={() => supabase.auth.signOut()}>Abmelden</button>
        </header>
        <main className="flex-1 px-4 py-4">
          <Routes>
            <Route path="/" element={<RecipeList />} />
            <Route path="/rezept/:id" element={<RecipeDetail />} />
            <Route path="/kochen" element={<WhatToCook />} />
            <Route path="/scannen" element={<Upload />} />
          </Routes>
        </main>
        <nav className="fixed inset-x-0 bottom-0 grid grid-cols-3 border-t border-stone-200 bg-white pb-[env(safe-area-inset-bottom)] sm:hidden">
          <Tab to="/" mobile>Rezepte</Tab>
          <Tab to="/kochen" mobile>Was koche ich?</Tab>
          <Tab to="/scannen" mobile>Hinzufügen</Tab>
        </nav>
      </div>
    </HashRouter>
  )
}

function Tab({ to, children, mobile }: { to: string; children: React.ReactNode; mobile?: boolean }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        mobile
          ? `py-3 text-center text-xs font-medium ${isActive ? 'text-lime-800' : 'text-stone-500'}`
          : `rounded-lg px-3 py-1.5 text-sm ${isActive ? 'bg-lime-100 text-lime-900' : 'text-stone-600 hover:bg-stone-200'}`
      }
    >
      {children}
    </NavLink>
  )
}
