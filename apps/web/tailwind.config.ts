import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        electric: {
          amber: '#F59E0B',
          amberLight: '#FBBF24',
          cyan: '#06B6D4',
          violet: '#7C3AED',
          lavender: '#A78BFA',
        },
        surface: {
          bg: '#0B0B10',
          card: '#13131A',
          border: '#1E1E2E',
          hover: '#1A1A24',
        },
      },
      keyframes: {
        shimmer: {
          '0%': { borderColor: '#F59E0B' },
          '33%': { borderColor: '#06B6D4' },
          '66%': { borderColor: '#7C3AED' },
          '100%': { borderColor: '#F59E0B' },
        },
        bob: {
          '0%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
          '100%': { transform: 'translateY(0px)' },
        },
        flicker: {
          '0%': { opacity: '1' },
          '25%': { opacity: '0.7' },
          '50%': { opacity: '1' },
          '75%': { opacity: '0.9' },
          '100%': { opacity: '1' },
        },
        pulse_ring: {
          '0%': { transform: 'scale(1)', opacity: '0.8' },
          '50%': { transform: 'scale(1.08)', opacity: '0.4' },
          '100%': { transform: 'scale(1)', opacity: '0.8' },
        },
      },
      animation: {
        shimmer: 'shimmer 3s linear infinite',
        bob: 'bob 3s ease-in-out infinite',
        flicker: 'flicker 2.5s ease-in-out infinite',
        pulse_ring: 'pulse_ring 1.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config
