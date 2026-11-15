import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // WaselERP ReDesign (D17) — Navy + Sky identity (Soft Rounded)
        brand: {
          50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc',
          400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1',
          800: '#075985', 900: '#0c4a6e', 950: '#082f3f',
        },
        navy: {
          800: '#1e293b', 850: '#172033', 900: '#0f172a', 925: '#0b1220', 950: '#020617',
        },
        surface: 'rgb(var(--wm-surface) / <alpha-value>)',
        ink: 'rgb(var(--wm-ink) / <alpha-value>)',
        'ink-soft': 'rgb(var(--wm-ink-soft) / <alpha-value>)',
        line: 'rgb(var(--wm-line) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Tajawal', 'Cairo', 'Segoe UI', 'system-ui', 'sans-serif'],
        num: ['Rubik', 'Tajawal', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2.5xl': '1.25rem', '3xl': '1.5rem', '4xl': '2rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(15 23 42 / 0.05), 0 2px 8px rgb(15 23 42 / 0.06)',
        lift: '0 8px 24px rgb(15 23 42 / 0.12)',
        pop: '0 16px 40px rgb(15 23 42 / 0.18)',
      },
    },
  },
  plugins: [],
};

export default config;
