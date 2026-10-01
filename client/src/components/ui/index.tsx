import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react'
import React from 'react'
import { cn } from '../../lib/utils'
export { cn }

// --- Button ---
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'success'
  size?: 'sm' | 'md' | 'lg' | 'icon'
  children: ReactNode
}

export function Button({
  className,
  variant = 'default',
  size = 'md',
  children,
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50'
  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    outline: 'border border-border bg-transparent hover:bg-secondary hover:text-secondary-foreground',
    ghost: 'hover:bg-secondary hover:text-secondary-foreground',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    success: 'bg-success text-success-foreground hover:bg-success/90',
  }
  const sizes = {
    sm: 'h-8 px-3 text-xs rounded-md',
    md: 'h-10 px-4 text-sm rounded-lg',
    lg: 'h-12 px-6 text-base rounded-lg',
    icon: 'h-10 w-10 rounded-lg',
  }

  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  )
}

// --- Input ---
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ className, label, error, id, ...props }: InputProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <input
        id={id}
        className={cn(
          'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive',
          className
        )}
        {...props}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// --- Select ---
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  children: ReactNode
}

export function Select({ className, label, error, id, children, ...props }: SelectProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <select
        id={id}
        className={cn(
          'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive',
          className
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// --- Textarea ---
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export function Textarea({ className, label, error, id, ...props }: TextareaProps) {
  return (
    <div className="space-y-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
      )}
      <textarea
        id={id}
        className={cn(
          'flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive',
          className
        )}
        {...props}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

// --- Card ---
interface CardProps {
  className?: string
  children: ReactNode
  hover?: boolean
  onClick?: () => void
}

export function Card({ className, children, hover = false, onClick }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        hover && 'transition-shadow hover:shadow-md cursor-pointer',
        onClick && 'cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col space-y-1.5 p-6', className)}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h3 className={cn('font-semibold leading-none tracking-tight', className)}>
      {children}
    </h3>
  )
}

export function CardDescription({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      {children}
    </p>
  )
}

export function CardContent({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('p-6 pt-0', className)}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex items-center p-6 pt-0', className)}>
      {children}
    </div>
  )
}

// --- Dialog (simple overlay) ---
interface DialogProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}

export function Dialog({ open, onClose, children, className }: DialogProps) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center p-4',
          className
        )}
      >
        <div
          className="w-full max-w-lg rounded-xl border border-border bg-card shadow-xl animate-in fade-in-0 zoom-in-95"
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

// --- Badge ---
interface BadgeProps {
  className?: string
  variant?: 'default' | 'secondary' | 'outline' | 'income' | 'expense' | 'destructive' | 'success' | 'warning'
  children: ReactNode
}

export function Badge({ className, variant = 'default', children }: BadgeProps) {
  const variants = {
    default: 'bg-primary/10 text-primary',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border border-border text-foreground',
    income: 'bg-income/10 text-income',
    expense: 'bg-expense/10 text-expense',
    destructive: 'bg-destructive/10 text-destructive',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
  }

  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
      variants[variant],
      className
    )}>
      {children}
    </span>
  )
}

// --- Progress ---
interface ProgressProps {
  className?: string
  value: number
  max?: number
  color?: string
  showLabel?: boolean
}

export function Progress({ className, value, max = 100, color, showLabel = false }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))
  const isOver = pct > 100

  return (
    <div className={cn('space-y-1', className)}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${Math.min(pct, 100)}%`,
            backgroundColor: color || (isOver ? 'var(--color-destructive)' : 'var(--color-primary)'),
          }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-muted-foreground">
          {Math.round(pct)}%{isOver ? ' (over)' : ''}
        </span>
      )}
    </div>
  )
}

// --- Empty State ---
interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
      {icon && <div className="mb-4 text-4xl opacity-50">{icon}</div>}
      <h3 className="text-lg font-medium text-foreground mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// --- Tabs ---
interface TabsProps {
  defaultValue: string
  values: string[]
  labels: string[]
  children: (value: string) => ReactNode
  className?: string
}

export function Tabs({ defaultValue, values, labels, children, className }: TabsProps) {
  const [active, setActive] = React.useState(defaultValue)

  return (
    <div className={className}>
      <div className="flex gap-1 border-b border-border">
        {values.map((v, i) => (
          <button
            key={v}
            onClick={() => setActive(v)}
            className={cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-0 transition-colors',
              active === v
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {labels[i]}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {children(active)}
      </div>
    </div>
  )
}

// --- Skeleton ---
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('animate-pulse rounded-lg bg-secondary', className)} />
  )
}

// --- Toast / Alert ---
interface AlertProps {
  variant?: 'default' | 'destructive' | 'success' | 'warning'
  children: ReactNode
  className?: string
}

export function Alert({ variant = 'default', children, className }: AlertProps) {
  const variants = {
    default: 'bg-primary/10 text-primary border-primary/20',
    destructive: 'bg-destructive/10 text-destructive border-destructive/20',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
  }

  return (
    <div className={cn(
      'rounded-lg border px-4 py-3 text-sm flex items-start gap-3',
      variants[variant],
      className
    )}>
      {children}
    </div>
  )
}
