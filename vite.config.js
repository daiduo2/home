import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

/**
 * GLSL `#include <name>` 预处理器。
 * 3d-folio 原本用 glslify-loader，Vite 没有等价物，这里手写一个最小实现。
 * 规则：#include <foo> 会去找 src/shaders/partials/foo.glsl，递归展开。
 *
 * 两个必须注意的点：
 * 1. three 自带的着色器 chunk 也是 `#include <common>` 这种写法，但它们不经过这个插件
 *    （three 的 chunk 在 node_modules 里，由 three 自己解析）。不过为了安全，
 *    找不到对应 partial 文件时保持原样不动，而不是抛错。
 * 2. Vite 插件的 transform 必须返回合法的 JS 模块，裸 GLSL 会被当 JS 解析而报错。
 */
function glslInclude() {
  const partialsDir = path.resolve(process.cwd(), 'src/shaders/partials')

  function resolveIncludes(code, depth = 0) {
    if (depth > 8) {
      throw new Error('GLSL #include 嵌套过深，可能存在循环引用')
    }
    return code.replace(/^[ \t]*#include\s+<([\w.-]+)>[ \t]*$/gm, (match, name) => {
      const file = path.join(partialsDir, `${name}.glsl`)
      if (!fs.existsSync(file)) {
        // 不是我们的 partial，原样保留
        return match
      }
      const included = fs.readFileSync(file, 'utf8')
      return resolveIncludes(included, depth + 1)
    })
  }

  return {
    name: 'glsl-include',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.glsl')) {
        return null
      }
      const resolved = resolveIncludes(code)
      return {
        code: `export default ${JSON.stringify(resolved)}`,
        map: null,
      }
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [glslInclude()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          physics: ['cannon-es'],
        },
      },
    },
  },
})
