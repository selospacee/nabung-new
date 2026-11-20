import type { ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useMemo } from 'react'
import { cn } from '../../lib/utils'
import {
  LayoutDashboard,
  Tag,
  LineChart,
  Wallet,
  Settings,
  Plus,
  CreditCard,
  Banknote,
  PiggyBank,
  Utensils,
  Heart,
  Film,
  GraduationCap,
  Package,
  Building2,
  Car,
  ShoppingBag,
  FileText,
  ArrowRightLeft,
  MoreHorizontal,
  Building2 as Building2Icon,
  Users,
} from 'lucide-react'
import { Button } from '../../components/ui'
import { useState } from 'react'
import { useCurrentUser } from '../../db/hooks'
import { AddTransactionModal } from '../AddTransactionModal'
import { useAutoSync } from '../../hooks/useAutoSync'
import { SyncIndicator } from '../sync/SyncStatus'
import { useAccounts, useCategories, useDefaultAccount, useTransactions, useAccountBalances } from '../../db/hooks'

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/budgets', icon: LineChart, label: 'Budgets & Categories' },
  { to: '/groups', icon: Users, label: 'Nabung Bareng' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

// Mobile bottom nav: 4 main + 1 add button = 5 items (3rd is add button)
const MOBILE_NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/budgets', icon: LineChart, label: 'Budgets' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { user, userId } = useCurrentUser()
  
  // Auto-sync: periodic + realtime + focus
  useAutoSync(true)
  const accounts = useAccounts(userId)
  const categories = useCategories(userId)
  const defaultAccount = useDefaultAccount()
  const transactions = useTransactions(userId)
  const balances = useAccountBalances(userId)
  
  const [showAddModal, setShowAddModal] = useState(false)
  const [modalKey, setModalKey] = useState(0)

  const handleTransactionAdded = () => {
    // Close modal and reset for next use
    setShowAddModal(false)
    setModalKey(k => k + 1)
  }

  const accountsWithBalance = useMemo(() => {
    return (accounts || []).map(a => ({ ...a, balance: balances[a.id] || 0 }))
  }, [accounts, balances])

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
            <aside className="hidden lg:flex flex-col w-64 shrink-0 glass-strong rounded-2xl m-3 h-[calc(100vh-1.5rem)] sticky top-3">
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
                    ? 'glass-active text-foreground'
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

      {/* Mobile bottom navigation: slots (Dashboard, Budgets, +, Bareng, Settings) */}
            <nav className="fixed bottom-2 left-2 right-2 z-50 lg:hidden rounded-2xl glass-strong">
              <div className="flex items-center justify-between px-2 py-1.5 w-full">
                <div className="flex items-center justify-around w-full">
                  {/* Dashboard - slot 1 */}
                  <NavLink
                    to="/"
                    end
                    className={cn(
                      'flex flex-col items-center gap-1 px-1 py-2 rounded-lg text-xs font-medium transition-colors',
                      location.pathname === '/'
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    )}
                  >
                    <LayoutDashboard className="w-5 h-5" />
                    Beranda
                  </NavLink>

                  {/* Budgets - slot 2 */}
                  <NavLink
                    to="/budgets"
                    className={cn(
                      'flex flex-col items-center gap-1 px-1 py-2 rounded-lg text-xs font-medium transition-colors',
                      location.pathname.startsWith('/budgets')
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    )}
                  >
                    <LineChart className="w-5 h-5" />
                    Budgets
                  </NavLink>

                  {/* Add Transaction button - slot 3 (center) */}
                                                      <Button
                                                        onClick={() => setShowAddModal(true)}
                                                        className="flex flex-col items-center gap-1 rounded-full bg-primary text-primary-foreground shadow-lg -mt-12 h-16 w-16 shrink-0"
                                                      >
                                                        <Plus className="w-[60px] h-[60px]" />
                                                      </Button>


                  {/* Nabung Bareng - slot 5 */}
                  <NavLink
                    to="/groups"
                    className={cn(
                      'flex flex-col items-center gap-1 px-1 py-2 rounded-lg text-xs font-medium transition-colors',
                      location.pathname.startsWith('/groups') || location.pathname.startsWith('/join')
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    )}
                  >
                    <Users className="w-5 h-5" />
                    Bareng
                  </NavLink>

                  {/* Settings - slot 6 */}
                  <NavLink
                    to="/settings"
                    className={cn(
                      'flex flex-col items-center gap-1 px-1 py-2 rounded-lg text-xs font-medium transition-colors',
                      location.pathname.startsWith('/settings')
                        ? 'text-primary'
                        : 'text-muted-foreground'
                    )}
                  >
                    <Settings className="w-5 h-5" />
                    Settings
                  </NavLink>
                </div>
              </div>
            </nav>

            {/* Remove floating FAB - now integrated in bottom nav */}

                              {/* Main content */}
            <main className="flex-1 p-4 lg:p-6 max-w-7xl w-full pb-24 lg:pb-0">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">
            {NAV_ITEMS.find(item => {
              if (item.end) return location.pathname === item.to
              return location.pathname.startsWith(item.to)
            })?.label || 'Nabung'}
          </h2>
          <SyncIndicator />
        </div>
        {children}
              </main>

              {/* Add Transaction Modal */}
              <AddTransactionModal
                key={modalKey}
                open={showAddModal}
                onClose={() => setShowAddModal(false)}
                user={user}
                userId={userId || ''}
                accounts={accounts || []}
                categories={categories || []}
                defaultAccount={defaultAccount}
                transactions={transactions || []}
                onTransactionAdded={handleTransactionAdded}
              />
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