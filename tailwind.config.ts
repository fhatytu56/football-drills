import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        club: {
          50: '#eefcf1',
          100: '#d5f7dc',
          200: '#a9eeb9',
          400: '#59cc74',
          500: '#2e9e44',
          600: '#257f37',
          700: '#1d642c',
          800: '#164e23',
          900: '#113d1c',
        },
      },
      fontFamily: {
        display: ['Poppins', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
