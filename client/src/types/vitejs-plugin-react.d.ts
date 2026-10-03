declare module '@vitejs/plugin-react' {
  import type { Plugin } from 'vite'
  interface ReactPluginOptions {
    include?: string | RegExp | Array<string | RegExp>
    exclude?: string | RegExp | Array<string | RegExp>
    jsxImportSource?: string
    babel?: {
      plugins?: string[]
      babelrc?: boolean
      configFile?: string | false
    }
  }
  export default function react(options?: ReactPluginOptions): Plugin
}