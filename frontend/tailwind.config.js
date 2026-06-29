/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // RAGcast design tokens (CLAUDE.md §10 + design handoff)
        bg: '#0A0A0A',
        panel: '#111111',
        card: '#1A1A1A',
        'card-2': '#161616',
        border: '#222222',
        'border-soft': '#1d1d1d',
        blue: '#0066FF',
        'blue-bright': '#2D82FF',
        green: '#00C48C',
        amazon: '#FF9900',
        text: '#F4F6FA',
        muted: '#8A8F98',
        'muted-2': '#6A6F78',
        danger: '#FF6B6B',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'Menlo', 'monospace'],
      },
      borderRadius: {
        // bubbles/input 18px, cards 13–16, sign-in card 24
        bubble: '18px',
        card: '16px',
        'card-sm': '13px',
        signin: '24px',
      },
      keyframes: {
        rise: {
          from: { transform: 'translateY(18px) scale(.98)' },
          to: { transform: 'none' },
        },
        'rise-menu': {
          from: { transform: 'translateY(6px)', opacity: '0' },
          to: { transform: 'none', opacity: '1' },
        },
        blink: {
          '0%,60%,100%': { opacity: '.25', transform: 'translateY(0)' },
          '30%': { opacity: '1', transform: 'translateY(-3px)' },
        },
        flash: {
          '0%': { boxShadow: '0 0 0 0 rgba(0,102,255,.5)' },
          '100%': { boxShadow: '0 0 0 14px rgba(0,102,255,0)' },
        },
      },
      animation: {
        rise: 'rise .6s cubic-bezier(.2,.8,.2,1)',
        'rise-menu': 'rise-menu .14s ease both',
        blink: 'blink 1.2s infinite',
        flash: 'flash .9s ease',
      },
      boxShadow: {
        signin:
          '0 0 0 1px rgba(0,102,255,.08), 0 30px 80px -20px rgba(0,0,0,.8), 0 0 70px -10px rgba(0,102,255,.18)',
        send: '0 6px 18px -6px rgba(0,102,255,.7)',
        menu: '0 18px 44px -12px rgba(0,0,0,.85)',
      },
    },
  },
  plugins: [],
};
