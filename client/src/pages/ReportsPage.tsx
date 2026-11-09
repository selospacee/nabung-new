import { useState, useMemo } from 'react'
import { useCurrentUser, useTransactions, useCategories, useCashiers } from '../db/hooks'
import { cn, Card, CardHeader, CardTitle, CardContent, Button, Badge, Select, EmptyState } from '../components/ui'
import { formatCurrency, centsToDisplay } from '../utils/currency'
import { toISODate, formatDate } from '../utils/dates'
import { startOfMonth, endOfMonth, subMonths, differenceInMonths, subDays } from 'date-fns'
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts'
import { Download, RefreshCw, Calendar, BarChart3, PieChart as PieChartIcon, TrendingUp, TrendingDown, MapPin, Users, DollarSign } from 'lucide-react'
import { TxnMap } from '../components/TxnMap'

const CHART_TYPES = [
  { value: 'line', label: 'Line', icon: TrendingUp },
  { value: 'bar', label: 'Bar', icon: BarChart3 },
  { value: 'pie', label: 'Pie', icon: PieChartIcon },
]

const REPORT_PERIODS = [
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
  { value: '90d', label: 'Last 90 Days' },
  { value: '6m', label: 'Last 6 Months' },
  { value: '1y', label: 'Last Year' },
  { value: 'all', label: 'All Time' },
]

const MAP_PROVIDERS = [
  { value: 'openstreetmap', label: 'OpenStreetMap', icon: MapPin },
  { value: 'google', label: 'Google Maps', icon: MapPin },
]

export function ReportsPage() {
  const { user, userId } = useCurrentUser()
  const currency = user?.currency || 'IDR'
  const transactions = useTransactions(userId)
  const categories = useCategories(userId)
  const [chartType, setChartType] = useState('line')
  const [period, setPeriod] = useState('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day')
  const [mapProvider, setMapProvider] = useState<'openstreetmap' | 'google'>('openstreetmap')

  // Filter transactions by period
  const filteredTxns = useMemo(() => {
    if (!transactions) return []
    const now = new Date()
    let start: Date, end: Date = now

    switch (period) {
      case '7d': 
        start = subDays(now, 7)
        break
      case '30d': 
        start = subDays(now, 30)
        break
      case '90d': 
        start = subDays(now, 90)
        break
      case '6m': 
        start = subMonths(now, 6)
        break
      case '1y': 
        start = subMonths(now, 12)
        break
      case 'all': 
        start = new Date(1970, 0, 1)
        break
      default: // custom
        if (customStart) {
          start = new Date(customStart)
        } else {
          start = subMonths(now, 1)
        }
        if (customEnd) {
          end = new Date(customEnd)
        } else {
          end = now
        }
        break
    }

    return transactions.filter(t => {
      const txDate = new Date(t.date)
      return txDate >= start && txDate <= end
    })
  }, [transactions, period, customStart, customEnd])

  // Located transactions (for map)
  const locatedTxns = useMemo(() => {
    if (!filteredTxns) return []
    return filteredTxns.filter(tx => tx.latitude !== null && tx.longitude !== null)
  }, [filteredTxns])

  // Map bounds for located transactions
  const mapBounds = useMemo(() => {
    if (!locatedTxns || locatedTxns.length === 0) return null
    const lats = locatedTxns.map(t => t.latitude).filter((lat): lat is number => lat !== null)
    const longs = locatedTxns.map(t => t.longitude).filter((lng): lng is number => lng !== null)
    if (lats.length === 0 || longs.length === 0) return null
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...longs),
      maxLng: Math.max(...longs)
    }
  }, [locatedTxns])

  // Padded view bounds — shared by the map tiles and the pin positions so pins align with the map
  const mapViewBounds = useMemo(() => {
    if (!mapBounds) return null
    const padLat = Math.max((mapBounds.maxLat - mapBounds.minLat) * 0.1, 0.005)
    const padLng = Math.max((mapBounds.maxLng - mapBounds.minLng) * 0.1, 0.005)
    return {
      minLat: mapBounds.minLat - padLat,
      maxLat: mapBounds.maxLat + padLat,
      minLng: mapBounds.minLng - padLng,
      maxLng: mapBounds.maxLng + padLng,
    }
  }, [mapBounds])

  // Time series data
  const timeSeriesData = useMemo(() => {
    if (filteredTxns.length === 0) return []

    const groupKey = groupBy === 'day' ? 'day' : groupBy === 'week' ? 'week' : 'month'
    const dataMap: Record<string, { income: number; expense: number }> = {}

    for (const tx of filteredTxns) {
      const d = new Date(tx.date + '-01')
      let key: string
      if (groupBy === 'day') {
        key = tx.date
      } else if (groupBy === 'week') {
        const weekStart = new Date(d)
        weekStart.setDate(d.getDate() - d.getDay())
        key = formatDate(toISODate(weekStart), 'MMM d')
      } else {
        key = d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
      }

      if (!dataMap[key]) dataMap[key] = { income: 0, expense: 0 }
      if (tx.type === 'income') dataMap[key].income += tx.amount
      else if (tx.type === 'expense') dataMap[key].expense += tx.amount
    }

    return Object.entries(dataMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, vals]) => ({
        name: key,
        income: vals.income,
        expense: vals.expense,
        net: vals.income - vals.expense,
      }))
  }, [filteredTxns, groupBy])

  // Category breakdown
  const categoryBreakdown = useMemo(() => {
    if (filteredTxns.length === 0) return []

    const byCat: Record<string, number> = {}

    for (const tx of filteredTxns) {
      if (tx.type !== 'expense') continue
      const catId = tx.categoryId || 'uncategorized'
      byCat[catId] = (byCat[catId] || 0) + tx.amount
    }

    return Object.entries(byCat)
      .map(([catId, value]) => {
        const cat = categories?.find(c => c.id === catId)
        return { 
          name: cat?.name || catId, 
          value, 
          color: cat?.color || '#6B7280' 
        }
      })
      .sort((a, b) => b.value - a.value)
  }, [filteredTxns, categories])

  // Summary stats
  const cashiers = useCashiers(userId, false)

    // Summary stats
    const stats = useMemo(() => {
      if (filteredTxns.length === 0) return { income: 0, expense: 0, net: 0, count: 0 }
      const income = filteredTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
      const expense = filteredTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
      return { income, expense, net: income - expense, count: filteredTxns.length }
    }, [filteredTxns])

    // Cashier performance breakdown
    const cashierBreakdown = useMemo(() => {
      if (!cashiers || filteredTxns.length === 0) return []
    
      return cashiers.map(cashier => {
        const cashierTxns = filteredTxns.filter(t => t.cashierId === cashier.id)
        const income = cashierTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0)
        const expense = cashierTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0)
        const totalCups = cashierTxns.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount / 100), 0) // 1 unit = 1 cup
        const commissionEarned = totalCups * (cashier.cupCommission || 0)
        const totalPay = (cashier.baseSalary || 0) + commissionEarned
      
        return {
          cashier,
          transactions: cashierTxns,
          income,
          expense,
          net: income - expense,
          totalCups,
          commissionEarned,
          totalPay,
          count: cashierTxns.length,
        }
      }).filter(c => c.count > 0)
    }, [cashiers, filteredTxns])

  // Export CSV
      const exportCsv = () => {
              if (!filteredTxns.length) return
              // Properly escape CSV fields (handles commas and quotes)
              const escape = (val: string | number | null | undefined): string => {
                const s = val == null ? '' : String(val)
                const needsQuote = s.includes(',') || s.includes('"') || s.includes('\n')
                return needsQuote ? '"' + s.replace(/"/g, '""') + '"' : s
              }
              const header = 'Date,Merchant,Description,Category,Type,Amount,Account,Location,Latitude,Longitude,Cashier\n'
              const rows = filteredTxns.map(tx => {
                const cat = categories?.find(c => c.id === tx.categoryId)
                const cashier = cashiers?.find(c => c.id === tx.cashierId)
                return `${escape(tx.date)},${escape(tx.merchant)},${escape(tx.description)},${escape(cat ? cat.name : 'Uncategorized')},${escape(tx.type)},${escape(tx.amount)},${escape(tx.accountId)},${escape(tx.location || '')},${escape(tx.latitude ?? '')},${escape(tx.longitude ?? '')},${escape(cashier ? cashier.name : '')}`
              }).join('\n')
              const blob = new Blob([header + rows], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `nabung-export-${toISODate(new Date())}.csv`
              a.click()
              URL.revokeObjectURL(url)
            }

            const exportCashierCsv = () => {
              if (!cashierBreakdown.length) return
              const escape = (val: string | number | null | undefined): string => {
                const s = val == null ? '' : String(val)
                const needsQuote = s.includes(',') || s.includes('"') || s.includes('\n')
                return needsQuote ? '"' + s.replace(/"/g, '""') + '"' : s
              }
              const header = 'Cashier,Role,Transactions,Cups Sold,Income,Expense,Net,Commission/Cup,Commission Earned,Base Salary,Total Pay\n'
              const rows = cashierBreakdown.map(item => {
                return `${escape(item.cashier.name)},${escape(item.cashier.role)},${escape(item.count)},${escape(item.totalCups)},${escape(item.income)},${escape(item.expense)},${escape(item.net)},${escape(item.cashier.cupCommission || 0)},${escape(item.commissionEarned)},${escape(item.cashier.baseSalary || 0)},${escape(item.totalPay)}`
              }).join('\n')
              const totalRow = `TOTAL,,${cashierBreakdown.reduce((s, c) => s + c.count, 0)},${cashierBreakdown.reduce((s, c) => s + c.totalCups, 0)},${cashierBreakdown.reduce((s, c) => s + c.income, 0)},${cashierBreakdown.reduce((s, c) => s + c.expense, 0)},${cashierBreakdown.reduce((s, c) => s + c.net, 0)},,${cashierBreakdown.reduce((s, c) => s + c.commissionEarned, 0)},${cashierBreakdown.reduce((s, c) => s + (c.cashier.baseSalary || 0), 0)},${cashierBreakdown.reduce((s, c) => s + c.totalPay, 0)}`
              const blob = new Blob([header + rows + '\n' + totalRow], { type: 'text/csv' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `nabung-payroll-${toISODate(new Date())}.csv`
              a.click()
              URL.revokeObjectURL(url)
            }

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="Period"
          value={period}
          onChange={e => setPeriod(e.target.value as any)}
          className="w-36"
        >
          {REPORT_PERIODS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </Select>

        <Select
          label="Group by"
          value={groupBy}
          onChange={e => setGroupBy(e.target.value as any)}
          className="w-32"
        >
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
        </Select>

        <Select
          label="Chart"
          value={chartType}
          onChange={e => setChartType(e.target.value as any)}
          className="w-28"
        >
          {CHART_TYPES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </Select>

        <div className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filteredTxns.length}>
                    <Download className="w-4 h-4 mr-1" /> Export CSV
                  </Button>
                  {cashierBreakdown.length > 0 && (
                    <Button variant="outline" size="sm" onClick={exportCashierCsv}>
                      <Download className="w-4 h-4 mr-1" /> Export Payroll
                    </Button>
                  )}
                </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Period</p>
            <p className="text-lg font-medium text-foreground mt-1">
              {period === 'custom' ? `${customStart || '—'} to ${customEnd || '—'}` : REPORT_PERIODS.find(p => p.value === period)?.label}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Transactions</p>
            <p className="text-lg font-bold text-foreground mt-1">{stats.count}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
              <TrendingUp className="w-3.5 h-3.5 text-income" />
              <span>Income</span>
            </div>
            <p className="text-xl font-bold text-income font-mono mt-0.5">
              {formatCurrency(stats.income, currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
              <TrendingDown className="w-3.5 h-3.5 text-expense" />
              <span>Expense</span>
            </div>
            <p className="text-xl font-bold text-expense font-mono mt-0.5">
              {formatCurrency(stats.expense, currency)}
            </p>
          </CardContent>
        </Card>
      </div>

            {/* Cashier Performance Section */}
            {cashierBreakdown.length > 0 && (
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="w-4 h-4" /> Cashier Performance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-muted-foreground border-b border-border">
                          <th className="pb-2 font-medium">Cashier</th>
                          <th className="pb-2 font-medium text-right">Transactions</th>
                          <th className="pb-2 font-medium text-right">Cups Sold</th>
                          <th className="pb-2 font-medium text-right">Income</th>
                          <th className="pb-2 font-medium text-right">Expense</th>
                          <th className="pb-2 font-medium text-right">Net</th>
                          <th className="pb-2 font-medium text-right">Commission</th>
                          <th className="pb-2 font-medium text-right">Est. Pay</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {cashierBreakdown.map(item => (
                          <tr key={item.cashier.id}>
                            <td className="py-3 font-medium">{item.cashier.name} <span className="text-muted-foreground text-xs capitalize">({item.cashier.role})</span></td>
                            <td className="py-3 text-right">{item.count}</td>
                            <td className="py-3 text-right font-mono">{item.totalCups.toLocaleString()}</td>
                            <td className="py-3 text-right font-mono text-income">{formatCurrency(item.income, currency)}</td>
                            <td className="py-3 text-right font-mono text-expense">{formatCurrency(item.expense, currency)}</td>
                            <td className="py-3 text-right font-mono">{formatCurrency(item.net, currency)}</td>
                            <td className="py-3 text-right font-mono text-primary">{formatCurrency(item.commissionEarned, currency)}</td>
                            <td className="py-3 text-right font-bold font-mono text-primary">{formatCurrency(item.totalPay, currency)}</td>
                          </tr>
                        ))}
                        <tr className="font-semibold bg-secondary/50">
                          <td className="py-3">TOTAL</td>
                          <td className="py-3 text-right">{cashierBreakdown.reduce((s, c) => s + c.count, 0)}</td>
                          <td className="py-3 text-right font-mono">{cashierBreakdown.reduce((s, c) => s + c.totalCups, 0).toLocaleString()}</td>
                          <td className="py-3 text-right font-mono text-income">{formatCurrency(cashierBreakdown.reduce((s, c) => s + c.income, 0), currency)}</td>
                          <td className="py-3 text-right font-mono text-expense">{formatCurrency(cashierBreakdown.reduce((s, c) => s + c.expense, 0), currency)}</td>
                          <td className="py-3 text-right font-mono">{formatCurrency(cashierBreakdown.reduce((s, c) => s + c.net, 0), currency)}</td>
                          <td className="py-3 text-right font-mono text-primary">{formatCurrency(cashierBreakdown.reduce((s, c) => s + c.commissionEarned, 0), currency)}</td>
                          <td className="py-3 text-right font-bold font-mono text-primary">{formatCurrency(cashierBreakdown.reduce((s, c) => s + c.totalPay, 0), currency)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Map Section */}
      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Transaction Map
            </CardTitle>
            <Select
              value={mapProvider}
              onChange={e => setMapProvider(e.target.value as any)}
              className="w-32"
            >
              {MAP_PROVIDERS.map(provider => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {locatedTxns.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground py-10">
              <MapPin className="w-10 h-10 text-primary mb-2" />
              <p className="font-medium">No transactions with location data for this period</p>
              <small className="block mt-1">
                Enable location detection when adding transactions to see them on the map
              </small>
            </div>
          ) : (
            <div className="h-[400px] relative rounded-xl overflow-hidden border border-border z-0">
              {mapViewBounds ? (
                <TxnMap
                  locatedTxns={locatedTxns}
                  bounds={mapViewBounds}
                  mapProvider={mapProvider}
                  currency={currency}
                />
              ) : (
                // Fallback if bounds calculation failed
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <MapPin className="w-10 h-10 text-primary mb-2" />
                    <p className="font-medium">{locatedTxns.length} located transactions</p>
                    <p className="text-sm text-muted-foreground">
                      Unable to calculate map bounds
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {chartType === 'line' && 'Income vs Expense Over Time'}
            {chartType === 'bar' && 'Income vs Expense by Period'}
            {chartType === 'pie' && 'Expense Category Breakdown'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartType === 'pie' ? (
            categoryBreakdown.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {categoryBreakdown.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                    // @ts-expect-error - recharts Formatter type is too restrictive
                    formatter={(v: number | string | undefined) => [v ? formatCurrency(typeof v === 'number' ? v : parseFloat(v as string), currency) : '-', 'Amount']} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No expense data for this period
              </div>
            )
          ) : (
            timeSeriesData.length > 0 ? (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'line' ? (
                    <LineChart data={timeSeriesData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} />
                      <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={v => formatCurrency(v, currency)} />
                      <Tooltip
                        contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px' }}
                        // @ts-expect-error - recharts Formatter type is too restrictive
                        formatter={(v: number | string | undefined) => [v ? formatCurrency(typeof v === 'number' ? v : parseFloat(v as string), currency) : '-', '']}
                      />
                      <Line type="monotone" dataKey="income" stroke="var(--color-income)" strokeWidth={2} dot={false} name="Income" />
                      <Line type="monotone" dataKey="expense" stroke="var(--color-expense)" strokeWidth={2} dot={false} name="Expense" />
                    </LineChart>
                  ) : (
                    <BarChart data={timeSeriesData} barGap={4}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis dataKey="name" stroke="var(--color-muted-foreground)" fontSize={11} />
                      <YAxis stroke="var(--color-muted-foreground)" fontSize={11} tickFormatter={v => formatCurrency(v, currency)} />
                      <Tooltip
                        contentStyle={{ background: 'var(--color-card)', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '12px' }}
                        // @ts-expect-error - recharts Formatter type is too restrictive
                        formatter={(v: number | string | undefined) => [v ? formatCurrency(typeof v === 'number' ? v : parseFloat(v as string), currency) : '-', '']}
                      />
                      <Bar dataKey="income" fill="var(--color-income)" radius={[4, 4, 0, 0]} name="Income" />
                      <Bar dataKey="expense" fill="var(--color-expense)" radius={[4, 4, 0, 0]} name="Expense" />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No data for this period
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  )
}
