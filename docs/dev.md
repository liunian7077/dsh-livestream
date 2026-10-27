# 开发与调试

插件有三块代码，构建成三个产物。改哪一块、怎么看到效果，见下表：

| 改哪里 | 构建产物 | 谁加载 | 保存后怎么生效 |
|---|---|---|---|
| `src/console/` | `lib/client.js` | DSH 网页外壳（侧栏「直播」→ 控制台） | DSH 自带的热更新换掉控制台插件（1 秒内），不用重启 |
| `src/stage/`、`stage/index.html`、`stage/stage.css` | `lib/stage.js`、`stage/stage.css` | 插件自己的舞台服务器（OBS 浏览器源、控制台预览） | 舞台服务器让开着的页面自己刷新 |
| `src/dsh/`、`src/body/`、`src/core/` | `lib/index.js`、`lib/agent.js`、`lib/chunks/` | DSH 宿主进程 | 要重启 DSH（见下面「宿主端」） |

## 第一次准备

```bash
pnpm install
```

把插件包链接到 DSH 的插件目录（只做一次，已经有了就跳过）。DSH 桌面版是
`$DSH_HOME/profiles/<profile>/node_modules/dsh-livestream`，网页版是
`$DSH_HOME/profiles/web/node_modules/dsh-livestream`：

```bash
ln -s "$(pwd)/packages/dsh-livestream" ~/.dsh/profiles/desktop/node_modules/dsh-livestream
```

然后在仓库根目录开一个终端：

```bash
pnpm -C packages/dsh-livestream dev
```

它用 [tsdown](https://tsdown.dev)（rolldown）盯着 `src/`，只在文件变化时重建，产物不压缩、带 sourcemap。
配置在 [`packages/dsh-livestream/tsdown.config.ts`](../packages/dsh-livestream/tsdown.config.ts)，
三块代码各自的配置在 [`build/config.ts`](../packages/dsh-livestream/build/config.ts)。窗口不要关，`Ctrl+C` 结束。

- `pnpm -C packages/dsh-livestream dev`：宿主端 + 控制台 + 舞台页都盯着。
- `pnpm -C packages/dsh-livestream dev:web`：只盯控制台和舞台页（只调页面时更快）。
- `pnpm -C packages/dsh-livestream build`：正式构建（先清空 `lib/`，再压缩、不带 sourcemap）。

构建产物的文件名是固定的：`lib/index.js`、`lib/agent.js`（共用 `lib/chunks/`）、`lib/client.js`、`lib/stage.js`。
DSH 按 `package.json` 的 `exports` 加载前两个，舞台页的 `index.html` 直接引 `/stage.js`，所以别改。
`tools/*.ts` 那些一次性的开发脚本还是用 `npx esbuild` 打包（见各脚本开头的用法），和插件构建无关。

舞台页的热刷新长在舞台服务器里，所以更新插件代码后要重启一次 DSH；之后调页面就不用再重启了。

## 舞台页

控制台里复制「舞台地址」，直接在新标签页打开就是观众看到的那一页（带 token）。
控制台的预览 iframe 也是同一个页面（多一个 `&preview=1`，静音、不回执）。

保存 `src/stage/`、`stage/index.html` 或 `stage/stage.css` 后：

1. tsdown 重建 `lib/stage.js`；
2. 舞台服务器（插件里，跟在 DSH 一起跑）每 400ms 看一眼构建产物的修改时间和大小；
3. 变了就给所有开着的舞台页推一条 `reload` 事件，页面自己 `location.reload()`。

所以浏览器里的舞台页、控制台里的预览、OBS 的浏览器源都会自己刷新，不用手动点 OBS 的「刷新」。
改模板自己的样式（`assets/templates/<id>/style.css`）不走这条链路，刷新一次页面就能看到。

调试：

- 在普通浏览器里打开舞台地址，F12 → Console / Elements / Network 都能用；舞台状态和事件处理都在 `src/stage/store.ts`。
- 因为是开发构建，`Sources` 里能把 `lib/stage.js` 映射回 `src/stage/*.tsx`，断点直接打在 TS 源码上。
- OBS 里的页面也能调试：OBS 的浏览器源右键 →「交互」，或者先用普通浏览器打开同一个地址调试布局。

## 控制台

控制台是 DSH 的浏览器插件（`dsh.client`，入口 `lib/client.js`）。DSH 网页外壳带着
`@deepseek-ai/dsh-client-hmr`：它每 500ms 看一次每个插件的 `lib/client.js` 的修改时间/大小，
一变就在开着的页面里使旧模块失效、取新 bundle、重新执行 `apply`。插件面板开着时保存
`src/console/`，面板会在 1 秒内换成新代码。

注意：

- 面板的 React 状态会重置（跟着重载重新挂载），直播本身在宿主端，不受影响。
- 如果一直不换：先手动刷新一次 DSH 页面。还没变，说明这个 DSH 版本/部署没有挂 `client-hmr`
  （`dsh web` 和桌面版默认都挂了），那就只能重启 DSH。
- 桌面版打开 DevTools：菜单里的开发者工具，或 `Cmd+Opt+I`（Windows 是 `Ctrl+Shift+I`）。
  控制台的源码同样有 sourcemap，断点可以打在 `src/console/console.tsx` 上。

## 宿主端

`src/dsh/`、`src/body/`、`src/core/` 编译进 `lib/index.js` / `lib/agent.js`，由 DSH 宿主进程加载。
`dev` 会重建，但宿主不会自己换代码：重启 DSH。

- 开发机是 Windows（`tools/restart-dsh.sh` 那套）：`bash tools/restart-dsh.sh`。
- 桌面版：退出后重新打开。
- 如果想让宿主端也自动重载，可以在 DSH 的 profile patch
  （`$DSH_HOME/profiles/<profile>/cordis.patch.yml`）里让 HMR 盯插件的 `lib`：

  ```yaml
  - id: hmr
    disabled: false
    config:
      root: ["/绝对路径/packages/dsh-livestream/lib"]
  ```

  这是 DSH 宿主侧的热重载：`lib/index.js` 一变，插件会被停掉再加载一次。直播中的会话、
  推流这些状态会跟着断一下，调试宿主时用，别在正式直播时开。

## 常用命令

```bash
pnpm -C packages/dsh-livestream dev        # 开发：改哪建哪
pnpm -C packages/dsh-livestream dev:web    # 只调两个页面
pnpm -C packages/dsh-livestream check      # tsc 类型检查
pnpm -C packages/dsh-livestream test       # vitest
pnpm -C packages/dsh-livestream build      # 正式构建
```

## 排错

- 舞台页 401：地址里的 `token` 不对，从控制台重新复制完整地址（端口默认 7390）。
- 端口被占：改 `$DSH_HOME/dsh-livestream/settings.json` 里的 `stagePort`，或在控制台设置里改。
- 侧栏没有「直播」条目、打开 DSH 报 `web boot: 1 entry did not activate` /
  `dsh-livestream: import failed: client-modules: require("fs") missed the module table`：
  控制台产物里混进了 node 内建模块。DSH 网页外壳只给 react 这类种子模块，`fs`/`zlib`/`util`
  一个都没有，整块 `lib/client.js` 就不激活（面板不出现，自然也没有舞台地址）。多半是某个依赖的
  Node 入口被打了进来——`qrcode` 的 `main` 就是这样，配置里已经把它 alias 到浏览器入口。
  构建时的 `dsh-livestream/no-node-imports` 会拦住这种产物（`pnpm build` 直接失败并指出是哪个
  模块），所以真出现这条错误，先 `pnpm -C packages/dsh-livestream build` 看它报什么。
- 控制台不热更新：确认 `lib/client.js` 的修改时间真的变了（`ls -l packages/dsh-livestream/lib`），
  再刷新一次 DSH 页面；仍然不行就重启 DSH。
- 舞台页不刷新：看 DSH 日志里有没有「舞台页的代码或样式重建了」。只在 `lib/stage.js`、
  `stage/index.html` 或 `stage/stage.css` 变化时推刷新；只改模板素材要手动刷新。
- 改了 `tsdown.config.ts`、`build/config.ts`、`package.json`、`cordis.patch.yml`：重启 `pnpm dev`；
  `package.json` 的改动还要重启 DSH。

## 角色素材

角色包在 `packages/dsh-livestream/assets/characters/<id>/`：`character.json` 写用哪些片段和插画，
其余文件由舞台服务器按 `/characters/<id>/<文件>` 直接发出去。`clips.size` 是视频原始尺寸，
`clips.frame` 是画面里人物真正占的那一块（舞台按它摆，人物不会缩在 16:9 画幅中间）。

「大肥鱼·Q版」（`dafeiyu-chibi`）的素材是整包从社区项目搬来的，短名对照、每个文件接在哪里，见
[`assets/characters/dafeiyu-chibi/ACTIONS.md`](../packages/dsh-livestream/assets/characters/dafeiyu-chibi/ACTIONS.md)。
