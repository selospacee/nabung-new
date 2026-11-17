import { AppShell } from './components/layout/AppShell'
import { Routes, Route } from 'react-router-dom'
import { OnboardingPage } from './pages/OnboardingPage'
import { DashboardPage } from './pages/DashboardPage'
import { TransactionsPage } from './pages/TransactionsPage'
import { AccountsPage } from './pages/AccountsPage'
import { BudgetsPage } from './pages/BudgetsPage'
import { ReportsPage } from './pages/ReportsPage'
import { SettingsPage } from './pages/SettingsPage'
import { GroupsPage } from './pages/GroupsPage'
import { GroupDetailPage } from './pages/GroupDetailPage'
import { JoinGroupPage } from './pages/JoinGroupPage'
import { useSupabaseAuth } from './auth/SupabaseAuthContext'
import { SupabaseAuthProvider } from './auth/SupabaseAuthContext'

function AppRoutes() {
  const { isOnboarded, isLoading, user } = useSupabaseAuth()

  console.log('[AppRoutes] Render:', { isLoading, isOnboarded, user: user?.id })

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-2xl">N</span>
          </div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!isOnboarded) {
    console.log('[AppRoutes] Showing OnboardingPage')
    return <OnboardingPage />
  }

  console.log('[AppRoutes] Showing Dashboard')
  return (
      <AppShell>
        <Routes>
                        <Route path="/" element={<DashboardPage />} />
                        <Route path="/transactions" element={<TransactionsPage />} />
                        <Route path="/transactions/new" element={<TransactionsPage />} />
                        <Route path="/accounts" element={<AccountsPage />} />
                        <Route path="/budgets" element={<BudgetsPage />} />
                        <Route path="/reports" element={<ReportsPage />} />
                        <Route path="/settings" element={<SettingsPage />} />
                        <Route path="/groups" element={<GroupsPage />} />
                        <Route path="/groups/:groupId" element={<GroupDetailPage />} />
                        <Route path="/join/:code" element={<JoinGroupPage />} />
                      </Routes>
      </AppShell>
    )
}

export default function App() {
  return (
    <SupabaseAuthProvider>
      <AppRoutes />
    </SupabaseAuthProvider>
  )
}
