module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        space: {
          950: "#0B0E14",
          900: "#151922",
        },
        neon: {
          green: "#00FFA3",
          yellow: "#FFD700",
        },
      },
      fontFamily: {
        ui: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(0,255,163,0.25), 0 12px 40px rgba(0,0,0,0.55)",
        glowYellow: "0 0 0 1px rgba(255,215,0,0.18), 0 12px 40px rgba(0,0,0,0.55)",
      },
    },
  },
  plugins: [],
};

