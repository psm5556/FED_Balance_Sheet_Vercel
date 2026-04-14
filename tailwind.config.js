/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0e1117',
        surface: '#1e1e2e',
        border: '#2d2d3d',
      },
    },
  },
  plugins: [],
};
