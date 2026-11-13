import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff', 100: '#d9eaff', 200: '#bcdaff', 300: '#8ec2ff',
          400: '#59a0ff', 500: '#337dff', 600: '#1b5cf5', 700: '#1447e1',
          800: '#173ab6', 900: '#19348f', 950: '#142156',
        },
      },
      fontFamily: {
        sans: ['Tajawal', 'Cairo', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
