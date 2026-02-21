/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./{app,src}/**/*.{html,ts}",
    "./src/**/*.{html,ts}",
    "./src/app/**/*.{html,ts}",
    "./src/components/**/*.{html,ts}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
    },
  },
  plugins: [],
}