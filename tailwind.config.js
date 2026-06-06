/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pokit: {
          DEFAULT: "var(--color-accent)",
          dark: "var(--color-accent-dark)",
        },
        accent: "var(--color-accent)",
        "accent-dark": "var(--color-accent-dark)",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
