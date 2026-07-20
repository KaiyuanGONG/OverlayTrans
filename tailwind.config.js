/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        "microsoft-yahei": ["Microsoft YaHei UI", "Microsoft YaHei", "sans-serif"],
      },
      colors: {
        "overlay-bg": "rgba(0, 0, 0, 0.75)",
        brand: {
          cyan: "#22D3EE",
          indigo: "#6366F1",
          violet: "#A855F7",
        },
      },
    },
  },
  plugins: [],
};
