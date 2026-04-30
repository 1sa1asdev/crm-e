/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas:   '#0f1419',
        surface:  '#1a1f26',
        raised:   '#232a33',
        edge:     '#2d3642',
        hi:       '#e5e9f0',
        lo:       '#9aa4b2',
        primary:  '#5eb5ff',
        'primary-h': '#7cc4ff',
        danger:   '#ff6b6b',
        success:  '#51cf66',
        warn:     '#ffd43b',
        violet:   '#a78bfa',
        gmail:    '#EA4335',
        outlook:  '#0078D4',
      },
      borderRadius: { DEFAULT: '8px' },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
