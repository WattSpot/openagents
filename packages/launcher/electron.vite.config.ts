import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const trialDefine = { __TRIAL_ORIGIN__: JSON.stringify(process.env.OPENAGENTS_TRIAL_ORIGIN || null) }

export default defineConfig({
  main: {
    define: trialDefine,
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    define: trialDefine,
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          // Second entry, loaded only by the embedded workspace view: it runs
          // on the workspace's own https origin and must carry nothing but the
          // session handoff. See src/main/workspace-host.ts.
          'workspace-view': resolve('src/preload/workspace-view.ts')
        }
      }
    },
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    define: trialDefine,
    resolve: {
      dedupe: ['react', 'react-dom', 'sonner', 'radix-ui'],
      alias: {
        '@renderer': resolve('src/renderer'),
        '@': resolve('../../workspace/frontend')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
