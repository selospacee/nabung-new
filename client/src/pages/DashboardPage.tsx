import { useMemo, useState } from 'react'
import { useCurrentUser, useTransactions, useAccounts, useCategories, useDefaultAccount, computeMonthlyStats, computeMonthlyTrend } from '../db/hooks'
import { useIncomeCategories, useExpenseCategories } from '../db/hooks'
import { cn, Card, CardHeader, CardTitle, CardContent, Button, Badge, Progress, EmptyState, Skeleton } from '../components/ui'
import { formatCurrency, centsToDisplay } from '../utils/currency'
import { toISODate, formatDate, toYearMonth } from '../utils/dates'
import { startOfMonth, endOfMonth, subMonths } from 'date-fns'
import {
  TrendingUp, TrendingDown, Wallet, Plus, ArrowRightLeft,
  BarChart3, PieChart, Calendar,
} from 'lucide-react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart as RePieChart, Pie, Cell } from 'recharts'
import { useNavigate } from 'react-router-dom'

export function DashboardPage() {
  const { user } = useCurrentUser()
  const accounts = useAccounts()
  const categories = useCategories()
  const incomeCats = useIncomeCategories()
  const expenseCats = useExpenseCategories()
  const defaultAccount = useDefaultAccount()

  const [selectedMonth, setSelectedMonth] = useState(toYearMonth(new Date()))
  const navigate = useNavigate()

  const monthRange = useMemo(() => {
    // Ensure selectedMonth is valid (YYYY-MM format)
    if (!selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) {
      return { start: '', end: '' }
    }
    const d = new Date(selectedMonth + '-01')
    if (isNaN(d.getTime())) {
      return { start: '', end: '' }
    }
    return {
      start: toISODate(startOfMonth(d)),
      end: toISODate(endOfMonth(d)),
    }
  }, [selectedMonth])

  const { user: u } = useCurrentUser()
  const currency = user?.currency || 'USD'
  const userId = u?.id
  const transactions = useTransactions(userId, { startDate: monthRange.start, endDate: monthRange.end })
  const allTransactions = useTransactions(userId)

  const stats = useMemo(() => {
    if (!transactions) return null
    return computeMonthlyStats(transactions, selectedMonth)
  }, [transactions, selectedMonth])

  const trend = useMemo(() => {
    if (!allTransactions) return []
    return computeMonthlyTrend(allTransactions, 6)
  }, [allTransactions])

  const categoryData = useMemo(() => {
    if (!stats || !categories) return []
    return Object.entries(stats.byCategory)
      .map(([catId, vals]) => {
        const cat = categories.find(c => c.id === catId)
        return {
          name: cat?.name || 'Uncategorized',
          value: vals.expense,
          color: cat?.color || '#6B7280',
          icon: cat?.icon || 'MoreHorizontal',
        }
      })
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)
  }, [stats, categories])

  const totalBalance = useMemo(() => {
    if (!accounts) return 0
    return accounts.reduce((sum, a) => sum + a.balance, 0)
  }, [accounts])

  const prevMonth = () => {
    const d = new Date(selectedMonth + '-01')
    const prev = subMonths(d, 1)
    setSelectedMonth(toYearMonth(prev))
  }

  const nextMonth = () => {
    const d = new Date(selectedMonth + '-01')
    const next = subMonths(d, -1)
    if (next <= new Date()) setSelectedMonth(toYearMonth(next))
  }

  const isCurrentMonth = selectedMonth === toYearMonth(new Date())

  // Empty state
  if (!transactions || transactions.length === 0) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={<PieChart className="w-12 h-12" />}
          title="No transactions yet"
          description="Start tracking your finances by adding your first transaction."
          action={
            <Button onClick={() => navigate('/transactions/new')}>
              <Plus className="w-4 h-4 mr-2" />
              Add Transaction
            </Button>
          }
        />
      </div>
    )
  }

  const COLORS = ['#6366F1', '#10B981', '#F59E0B', '#EC4899', '#06B6D4', '#8B5CF6', '#F97316', '#6B7280']

  return (
    <div className="space-y-6">
      {/* Month selector */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" onClick={prevMonth} disabled={isCurrentMonth}>
          <ArrowRightLeft className="w-4 h-4 rotate-180" />
        </Button>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="text-lg font-semibold min-w-[140px] text-center">
            {formatDate(selectedMonth + '-01', 'MMMM yyyy')}
          </span>
        </div>
        <Button variant="outline" size="icon" onClick={nextMonth} disabled={isCurrentMonth}>
          <ArrowRightLeft className="w-4 h-4 rotate-0" />
        </Button>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/transactions/new')}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Balance</CardTitle>
            <Wallet className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground font-mono">
              {formatCurrency(totalBalance, currency)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Income</CardTitle>
            <TrendingUp className="w-4 h-4 text-income" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-income font-mono">
              {stats ? formatCurrency(stats.income, currency) : '-$'}
            </div>
            {stats && <p className="text-xs text-muted-foreground mt-1">{stats.count} transactions</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Expenses</CardTitle>
            <TrendingDown className="w-4 h-4 text-expense" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-expense font-mono">
              {stats ? formatCurrency(stats.expense, currency) : '-$'}
            </div>
            {stats && <p className="text-xs text-muted-foreground mt-1">{stats.count} transactions</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Net</CardTitle>
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold font-mono ${
              stats && stats.net >= 0 ? 'text-success' : 'text-expense'
            }`}>
              {stats ? formatCurrency(stats.net, currency) : '-$'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Income vs Expense bar chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Income vs Expense</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">Last 6 months</p>
          </CardHeader>
          <CardContent>
            {trend.length > 0 ? (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trend} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      dataKey="month"
                      tickFormatter={m => {
                        const d = new Date(m + '-01')
                        return d.toLocaleDateString('en', { month: 'short' })
                      }}
                      stroke="var(--color-muted-foreground)"
                      fontSize={12}
                    />
                    <YAxis
                      stroke="var(--color-muted-foreground)"
                      fontSize={12}
                      tickFormatter={v => formatCurrency(v, currency)}
                    />
                    <Tooltip
                      contentStyle={{
                        background: 'var(--color-card)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      // @ts-expect-error - recharts Formatter type is too restrictive
                      formatter={(value: number | string | undefined) => [value ? formatCurrency(typeof value === 'number' ? value : parseFloat(value as string), currency) : '-', '']}
                    />
                    <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} name="Income" />
                    <Bar dataKey="expense" fill="var(--color-expense)" radius={[4, 4, 0, 0]} name="Expense" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[240px] flex items-center justify-center text-muted-foreground">
                No data for this period
              </div>
            )}
          </CardContent>
        </Card>

        {/* Category donut */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Expense Breakdown</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{selectedMonth}</p>
          </CardHeader>
          <CardContent>
            {categoryData.length > 0 ? (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RePieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {categoryData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'var(--color-card)',
                        border: '1px solid var(--color-border)',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      // @ts-expect-error - recharts Formatter type is too restrictive
                      formatter={(value: number | string | undefined) => [value ? formatCurrency(typeof value === 'number' ? value : parseFloat(value as string), currency) : '-', '']}
                    />
                  </RePieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[240px] flex items-center justify-center text-muted-foreground">
                No expense data
              </div>
            )}

            {/* Category legend */}
            {categoryData.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {categoryData.map((cat, i) => (
                  <div key={cat.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }} />
                      <span className="text-foreground">{cat.name}</span>
                    </div>
                    <span className="font-mono text-muted-foreground">
                      {formatCurrency(cat.value, currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent transactions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Transactions</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate('/transactions')} className="ml-auto">
            View all
          </Button>
        </CardHeader>
        <CardContent>
          {transactions && transactions.length > 0 ? (
            <div className="space-y-2">
              {transactions.slice(0, 10).map(tx => {
                const cat = categories?.find(c => c.id === tx.categoryId)
                const account = accounts?.find(a => a.id === tx.accountId)
                const isIncome = tx.type === 'income'
                const icon = cat?.icon || (isIncome ? 'TrendingUp' : 'TrendingDown')

                return (
                  <div key={tx.id} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold"
                        style={{ backgroundColor: (cat?.color || '#6B7280') + '20', color: cat?.color || '#6B7280' }}>
                        <span className="uppercase">{icon?.[0] || '•'}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {tx.merchant || tx.description || 'Transaction'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {cat && (
                            <Badge variant={tx.type === 'income' ? 'income' : tx.type === 'expense' ? 'expense' : 'secondary'}>
                              {cat.name}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatDate(tx.date, 'MMM d')}
                            {account && <span className="ml-1">· {account.name}</span>}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className={cn(
                      'text-right font-mono text-sm font-semibold',
                      isIncome ? 'text-income' : tx.type === 'expense' ? 'text-expense' : 'text-foreground'
                    )}>
                      {isIncome ? '+' : tx.type === 'expense' ? '-' : ''}
                      {centsToDisplay(tx.amount, currency)}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <EmptyState
              title="No transactions this month"
              description="Add a transaction to see it here."
              action={
                <Button size="sm" onClick={() => navigate('/transactions/new')}>
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              }
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
