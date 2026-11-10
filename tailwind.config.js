import { fontFamily } from "tailwindcss/defaultTheme";

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        "2xl": "1360px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["thmanyahSans", "var(--font-ibm-arabic)", "var(--font-cairo)", ...fontFamily.sans],
        mono: ["var(--font-plex-mono)", ...fontFamily.mono],
      },
      colors: {
        /* متغيرات نظام التصميم الديناميكية (Light / Dark Mode) */
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: {
          DEFAULT: "var(--surface)",
          elevated: "var(--surface-elevated)",
          muted: "var(--muted)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",           /* #E51926 */
          bright: "var(--primary-bright)",     /* #EE1D23 */
          strong: "var(--primary-strong)",     /* #B9111C */
          accent: "var(--primary-accent)",     /* #FF4D58 */
          foreground: "var(--primary-foreground)", /* #FFFFFF */
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "#FFFFFF",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",

        /* لوحة ألوان هوية «بَلِّغْنِي | BALAGHNI» الثابتة */
        balaghni: {
          red: "#E51926",
          crimson: "#EE1D23",
          darkred: "#B9111C",
          softred: "#FFF1F2",
          obsidian: "#0B0D13",
          charcoal: "#141721",
          slate: "#1E2230",
          pure: "#FFFFFF",
        },
      },
      backgroundImage: {
        "primary-gradient":
          "linear-gradient(155deg, var(--primary-strong) 0%, var(--primary) 50%, var(--primary-bright) 100%)",
        "dark-hero-gradient":
          "radial-gradient(circle at 80% 15%, rgba(229, 25, 38, 0.22) 0%, transparent 55%), linear-gradient(180deg, #0B0D13 0%, #141721 100%)",
        "page-gradient":
          "linear-gradient(180deg, var(--page-gradient-top) 0%, var(--page-gradient-mid) 52%, var(--page-gradient-bottom) 100%)",
      },
      borderRadius: {
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
      boxShadow: {
        "primary-glow": "0 12px 32px -4px rgba(229, 25, 38, 0.28)",
        "primary-glow-lg": "0 20px 50px -8px rgba(229, 25, 38, 0.36)",
        "card-soft": "0 14px 34px rgba(11, 13, 19, 0.05)",
        "card-dark": "0 18px 42px rgba(0, 0, 0, 0.45)",
        "floating-pill": "0 8px 24px rgba(11, 13, 19, 0.06)",
      },
      keyframes: {
        "bell-ring": {
          "0%, 100%": { transform: "rotate(0deg)" },
          "15%": { transform: "rotate(12deg)" },
          "30%": { transform: "rotate(-10deg)" },
          "45%": { transform: "rotate(6deg)" },
          "60%": { transform: "rotate(-4deg)" },
          "75%": { transform: "rotate(2deg)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.95)", opacity: "0.7" },
          "70%": { transform: "scale(1.15)", opacity: "0" },
          "100%": { transform: "scale(1.15)", opacity: "0" },
        },
      },
      animation: {
        "bell-ring": "bell-ring 1.6s ease-in-out infinite",
        "pulse-ring": "pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
