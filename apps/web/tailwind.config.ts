import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
      },
      colors: {
        beige: {
          DEFAULT: '#F5ECD8',
          light: '#FBF7EE',
          dark: '#E8DCBF',
          warm: '#F0E4CC',
        },
        electric: {
          amber: '#F59E0B',
          amberLight: '#FBBF24',
          cyan: '#00F5FF',
          magenta: '#FF0080',
          violet: '#7C3AED',
          lavender: '#A78BFA',
          lime: '#A3E635',
          rose: '#FB7185',
        },
        park: {
          sky: '#87CEEB',
          skyDark: '#5BA3D9',
          grass: '#4ADE80',
          grassDark: '#22C55E',
          dirt: '#A0522D',
        },
        surface: {
          bg: '#F5ECD8',
          card: '#FFFFFF',
          border: '#000000',
          hover: '#FBF7EE',
        },
      },
      boxShadow: {
        brutal: '6px 6px 0 #000',
        'brutal-sm': '3px 3px 0 #000',
        'brutal-lg': '10px 10px 0 #000',
        'brutal-xl': '14px 14px 0 #000',
        'brutal-amber': '6px 6px 0 #F59E0B',
        'brutal-cyan': '6px 6px 0 #00F5FF',
        'brutal-magenta': '6px 6px 0 #FF0080',
        'brutal-violet': '6px 6px 0 #7C3AED',
        'brutal-lime': '6px 6px 0 #A3E635',
        'brutal-hover': '8px 8px 0 #000',
        'brutal-active': '2px 2px 0 #000',
      },
      keyframes: {
        shimmer: {
          '0%': { borderColor: '#F59E0B' },
          '33%': { borderColor: '#00F5FF' },
          '66%': { borderColor: '#FF0080' },
          '100%': { borderColor: '#F59E0B' },
        },
        bob: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        'bob-slow': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        wiggle: {
          '0%, 100%': { transform: 'rotate(-3deg)' },
          '50%': { transform: 'rotate(3deg)' },
        },
        'tail-wag': {
          '0%, 100%': { transform: 'rotate(-12deg)' },
          '50%': { transform: 'rotate(12deg)' },
        },
        pulse_ring: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
          '50%': { transform: 'scale(1.08)', opacity: '0.4' },
        },
        'scroll-park': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'scroll-clouds': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(30px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pixel-blink': {
          '0%, 90%, 100%': { opacity: '1' },
          '95%': { opacity: '0' },
        },
        'walk-cycle': {
          '0%, 100%': { transform: 'translateY(0px) scaleX(1)' },
          '25%': { transform: 'translateY(-3px) scaleX(1)' },
          '50%': { transform: 'translateY(0px) scaleX(1)' },
          '75%': { transform: 'translateY(-3px) scaleX(1)' },
        },
        'heart-float': {
          '0%': { opacity: '1', transform: 'translateY(0) scale(1)' },
          '100%': { opacity: '0', transform: 'translateY(-40px) scale(1.5)' },
        },
        scanline: {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(4px)' },
        },
        'color-cycle': {
          '0%, 100%': { color: '#F59E0B' },
          '25%': { color: '#00F5FF' },
          '50%': { color: '#FF0080' },
          '75%': { color: '#7C3AED' },
        },
        'bg-cycle': {
          '0%, 100%': { backgroundColor: '#F59E0B' },
          '25%': { backgroundColor: '#00F5FF' },
          '50%': { backgroundColor: '#FF0080' },
          '75%': { backgroundColor: '#7C3AED' },
        },
        'slide-in-left': {
          from: { opacity: '0', transform: 'translateX(-100px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(100px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        stamp: {
          '0%': { transform: 'scale(3) rotate(12deg)', opacity: '0' },
          '70%': { transform: 'scale(0.9) rotate(-2deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(-6deg)', opacity: '1' },
        },
      },
      animation: {
        shimmer: 'shimmer 3s linear infinite',
        bob: 'bob 2s ease-in-out infinite',
        'bob-slow': 'bob-slow 3s ease-in-out infinite',
        flicker: 'flicker 2.5s ease-in-out infinite',
        wiggle: 'wiggle 1s ease-in-out infinite',
        'tail-wag': 'tail-wag 0.3s ease-in-out infinite',
        pulse_ring: 'pulse_ring 1.8s ease-in-out infinite',
        'scroll-park': 'scroll-park 25s linear infinite',
        'scroll-clouds': 'scroll-clouds 60s linear infinite',
        marquee: 'marquee 35s linear infinite',
        'fade-up': 'fade-up 0.6s ease-out forwards',
        'pixel-blink': 'pixel-blink 3s step-end infinite',
        'walk-cycle': 'walk-cycle 0.6s steps(4) infinite',
        'heart-float': 'heart-float 2s ease-out infinite',
        scanline: 'scanline 0.1s steps(1) infinite',
        'color-cycle': 'color-cycle 4s linear infinite',
        'bg-cycle': 'bg-cycle 4s linear infinite',
        stamp: 'stamp 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards',
      },
    },
  },
  plugins: [],
}

export default config
