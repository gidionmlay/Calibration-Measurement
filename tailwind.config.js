export default {content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      colors: {
        ink: '#1c1c1c',
        'ink-hover': '#3a3a3a',
        sub: '#4a4a4a',
        faint: '#6b6b6b',
        line: '#c9c9c9',
        hair: '#e2e2e2',
        shade: '#d6d6d6',
        fill: '#ececec',
        canvas: '#f4f4f4',
        panel: '#ffffff',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
};
