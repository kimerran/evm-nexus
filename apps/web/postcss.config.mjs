// Tailwind CSS v4 is wired through its PostCSS plugin (no tailwind.config.js);
// tokens live in a @theme block in app/globals.css (BRAND.md).
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
