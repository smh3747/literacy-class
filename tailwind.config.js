/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2d6a4f',
          light: '#d8f3dc',
          dark: '#1b4332'
        }
      }
    },
  },
  plugins: [],
}
