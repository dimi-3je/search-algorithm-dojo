import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_ACTIONS && repositoryName && !repositoryName.endsWith('.github.io') ? `/${repositoryName}/` : '/'

export default defineConfig({
  base,
  plugins: [react()],
})
