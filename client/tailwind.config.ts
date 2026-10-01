import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        income: '#10B981',
        expense: '#EF4444',
      },
    },
  },
  plugins: [],
} satisfies Config
