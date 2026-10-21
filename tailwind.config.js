/** Tailwind build config (previously inlined in index.html for the Play CDN). Build with `npm run build:css`. */
module.exports = {
  content: ["./public/index.html", "./public/js/**/*.js"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        claude: {
          bg: "#0f1117",
          panel: "#161922",
          card: "#1d212d",
          border: "#2a3042",
          accent: "#d97757",
          accentHover: "#e3886b",
          amber: "#f59e0b",
          emerald: "#10b981",
          sky: "#38bdf8",
          purple: "#a855f7"
        }
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"]
      }
    }
  }
};
