/**
 * 构建配置：三块代码、四个产物。
 *
 *   宿主端  lib/index.js、lib/agent.js（共用的运行时拆进 lib/chunks/，两个入口拿到同一份 state）
 *   控制台  lib/client.js（DSH 的动态 client 模块；React 由网页外壳提供）
 *   舞台页  lib/stage.js（独立 IIFE，React 打进去；OBS 的浏览器源直接打开）
 *
 * `--watch`（pnpm dev）时：不压缩、带 sourcemap，改哪块建哪块。
 * 控制台由 DSH 自带的 client-hmr 轮询 lib/client.js 的 mtime 后热替换；
 * 舞台页由插件的舞台服务器盯着 lib/stage.js / stage/index.html / stage/stage.css，重建后让页面自己刷新。
 * 宿主端由 DSH 自带的 dsh-hmr 重载；pnpm dev 生成 lib/cordis.hmr.patch.yml，启动 DSH 时用 --patch 加载。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TsdownPlugin, UserConfig } from 'tsdown';

/** 开发构建（tsdown --watch）。tsdown 不会把 --watch 交给配置文件，直接看命令行 */
export const dev = process.argv.includes('--watch');

/** DSH 按 package.json 的 exports 加载 lib/index.js、lib/client.js，舞台页要 /stage.js：产物扩展名固定 .js */
const jsExtension = { js: '.js' };

/** ws 的可选原生加速包，以及需要保留安装目录资源的浏览器运行时。 */
const nodeExternals = ['bufferutil', 'utf-8-validate', 'playwright-core'];

/** 宿主端是 ESM，但 ws 内部要用 require */
const createRequireBanner = "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);";

/**
 * DSH 的浏览器模块加载器收下这个 factory：模块主体是惰性的，第一次 import 才跑。
 * React 不在包里，由外壳的模块表提供（client 配置里的 external）。
 */
const moduleLoaderBanner = 'window.__ModuleLoader__.load({id:"dsh-livestream",factory:(require)=>{var module={exports:{}};var exports=module.exports;';
const moduleLoaderFooter = 'return module.exports;}});';

const nodeEnv = dev ? '"development"' : '"production"';

/**
 * 网页外壳的模块表里只有它自己的种子模块（react 之类），没有 node 内建模块。依赖里谁偷偷
 * require("fs")，DSH 启动时就整块 import failed（控制台面板不出现，只在 web boot 日志里看得见）。
 * 所以在构建时拦住：出错的是 `pnpm build`，不是用户打开 DSH 的那一刻。
 */
function noNodeImports(): TsdownPlugin {
  const names = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
  return {
    name: 'dsh-livestream/no-node-imports',
    generateBundle(_options, bundle) {
      for (const [file, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [, specifier] of output.code.matchAll(/\b(?:require\(\s*|from\s*)["']([^"']+)["']/g)) {
          if (!names.has(specifier)) continue;
          this.error(`${file} 里出现了 node 内建模块 "${specifier}"：浏览器和网页外壳里都没有它，DSH 会整块 import failed。把它换成浏览器能用的包，或者 alias 掉。`);
        }
      }
    },
  };
}

/** 宿主端：根插件和 agent 子插件。两个入口必须共用 chunks——runtime.ts 是本进程里的单例状态 */
export function host(): UserConfig {
  return {
    name: 'dsh-livestream/host',
    entry: { index: 'src/dsh/index.ts', agent: 'src/dsh/agent.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: true,
    // package.json 是 type: module，产物用 .js（DSH 按 exports 里的路径加载）
    fixedExtension: false,
    outExtensions: () => jsExtension,
    // 普通依赖打进包里；浏览器运行时按需加载，保留自己的目录资源。
    deps: { neverBundle: nodeExternals, onlyBundle: false },
    banner: { js: createRequireBanner },
    // 共用的运行时（runtime.ts 的单例状态）拆进 lib/chunks/
    // HMR 按已加载的文件路径使缓存失效；开发时路径固定，共享状态变化才能同时重载根插件和 agent。
    outputOptions: { chunkFileNames: dev ? 'chunks/[name].js' : 'chunks/[name]-[hash].js' },
    hooks: dev ? {
      'build:prepare': () => {
        const libDir = fileURLToPath(new URL('../lib/', import.meta.url));
        mkdirSync(libDir, { recursive: true });
        writeFileSync(join(libDir, 'cordis.hmr.patch.yml'), [
          '# pnpm dev 自动生成；启动 DSH 时用 --patch 加载。',
          '- id: hmr',
          '  disabled: false',
          '  config:',
          `    root: [${JSON.stringify(libDir)}]`,
          '    ignored: ["**/*.map", "**/client.js", "**/stage.js", "**/cordis.hmr.patch.yml"]',
          '    debounce: 300',
          '',
        ].join('\n'));
      },
    } : undefined,
    dts: false,
    // 不在构建时清 lib/：清理由 package.json 的 build 脚本先做（watch 时也不能清）
    clean: false,
  };
}

/** 控制台：DSH 网页里的「直播」面板。cjs + 模块加载器的 factory 包装 */
export function client(): UserConfig {
  return {
    name: 'dsh-livestream/console',
    entry: { client: 'src/console/client.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    sourcemap: dev,
    minify: !dev ? true : false,
    fixedExtension: false,
    outExtensions: () => jsExtension,
    define: { 'process.env.NODE_ENV': nodeEnv },
    banner: { js: moduleLoaderBanner },
    footer: { js: moduleLoaderFooter },
    // qrcode 的 main 是 Node 入口（renderer/png.js 里 require("fs")），而 DSH 的模块表里没有 fs，
    // 整块控制台会 import failed。显式指向它的 browser 入口（canvas 渲染，不碰 fs）。
    alias: { qrcode: 'qrcode/lib/browser.js' },
    // React 由 DSH 网页外壳的模块表提供，不打进包里
    deps: { neverBundle: ['react', 'react/jsx-runtime'], onlyBundle: false },
    plugins: [noNodeImports()],
    dts: false,
    clean: false,
  };
}

/** 舞台页：一整页的脚本，React 打进去 */
export function stage(): UserConfig {
  return {
    name: 'dsh-livestream/stage',
    entry: { stage: 'src/stage/main.tsx' },
    outDir: 'lib',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    sourcemap: dev,
    minify: !dev ? true : false,
    fixedExtension: false,
    outExtensions: () => jsExtension,
    define: { 'process.env.NODE_ENV': nodeEnv },
    // tsdown 默认给 IIFE 产物加 .iife 后缀；舞台页要的是 lib/stage.js
    outputOptions: { entryFileNames: 'stage.js' },
    deps: { onlyBundle: false },
    plugins: [noNodeImports()],
    dts: false,
    clean: false,
  };
}
