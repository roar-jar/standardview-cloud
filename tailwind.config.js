/** @type {import('tailwindcss').Config} */
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{js,jsx}'),
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
