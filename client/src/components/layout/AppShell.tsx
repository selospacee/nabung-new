import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '../../lib/utils'
import {
  LayoutDashboard,
  Receipt,
  Tag,
  LineChart,
  PieChart,
  Wallet,
  Settings,
  Plus,
} from 'lucide-react'
import { Button } from '../../components/ui'

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/transactions', icon: Receipt, label: 'Transactions' },
  { to: '/accounts', icon: Wallet, label: 'Accounts' },
  { to: '/categories', icon: Tag, label: 'Categories' },
  { to: '/budgets', icon: LineChart, label: 'Budgets' },
  { to: '/reports', icon: PieChart, label: 'Reports' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()

  return (
    <div className="min-h-screen flex">
      {/* Mobile header */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-card/95 backdrop-blur-sm px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-sm">N</span>
          </div>
          <span className="font-semibold text-foreground">Nabung</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          {document.documentElement.classList.contains('light') ? '🌙' : '☀️'}
        </Button>
      </header>

      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border bg-card min-h-screen sticky top-0">
        <div className="flex items-center gap-2 px-6 py-5 border-b border-border">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-lg">N</span>
          </div>
          <div>
            <h1 className="font-bold text-foreground">Nabung</h1>
            <p className="text-xs text-muted-foreground">Personal Finance</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon
            const isActive = item.end
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to)

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-border">
          <Button variant="outline" className="w-full justify-start gap-2" onClick={toggleTheme}>
            <span className="text-lg">{document.documentElement.classList.contains('light') ? '🌙' : '☀️'}</span>
            <span className="text-sm">{document.documentElement.classList.contains('light') ? 'Dark mode' : 'Light mode'}</span>
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-4 md:p-6 max-w-7xl w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">
            {NAV_ITEMS.find(item => {
              if (item.end) return location.pathname === item.to
              return location.pathname.startsWith(item.to)
            })?.label || 'Nabung'}
          </h2>
          <Button variant="default" size="icon" className="md:hidden" onClick={() => {/* mobile add */}}>
            <Plus className="w-5 h-5" />
          </Button>
        </div>
        {children}
      </main>
    </div>
  )
}

function toggleTheme() {
  const html = document.documentElement
  if (html.classList.contains('light')) {
    html.classList.remove('light')
  } else {
    html.classList.add('light')
  }
}
