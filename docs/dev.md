# 开发与调试

插件有三块代码，构建成三个产物。改哪一块、怎么看到效果，见下表：

| 改哪里 | 构建产物 | 谁加载 | 保存后怎么生效 |
|---|---|---|---|
| `src/console/` | `lib/client.js` | DSH 网页外壳（侧栏「直播」→ 控制台） | DSH 自带的热更新换掉控制台插件（1 秒内），不用重启 |
| `src/stage/`、`stage/index.html`、`stage/stage.css` | `lib/stage.js`、`stage/stage.css` | 插件自己的舞台服务器（OBS 浏览器源、控制台预览） | 舞台服务器让开着的页面自己刷新 |
| `src/dsh/`、`src/body/`、`src/core/` | `lib/index.js`、`lib/agent.js`、`lib/chunks/` | DSH 宿主进程 | 加载开发 HMR patch 后，框架自动卸载旧插件、加载新代码 |

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

首次构建完成后，在仓库根目录另开一个终端启动 DSH：

```bash
dsh web --patch ./packages/dsh-livestream/lib/cordis.hmr.patch.yml
```

如果终端已在插件目录 `packages/dsh-livestream/`，使用：

```bash
dsh web --patch ./lib/cordis.hmr.patch.yml
```

`--patch` 的相对路径从当前终端目录解析；也可以传配置文件的绝对路径。

`dev` 自动生成这份 patch，里面是当前 checkout 的 `lib/` 绝对路径；不需要手改 DSH 主目录的配置。
已有的启动命令只要追加 `--patch <这份文件的路径>` 即可。桌面版等不方便传启动参数的场景，
也可以把生成文件的内容追加到对应 profile 的 `cordis.patch.yml`。

- `pnpm -C packages/dsh-livestream dev`：宿主端 + 控制台 + 舞台页都盯着。
- `pnpm -C packages/dsh-livestream dev:web`：只盯控制台和舞台页（只调页面时更快）。
- `pnpm -C packages/dsh-livestream build`：正式构建（先清空 `lib/`，再压缩、不带 sourcemap）。

构建产物的文件名是固定的：`lib/index.js`、`lib/agent.js`（共用 `lib/chunks/`）、`lib/client.js`、`lib/stage.js`。
DSH 按 `package.json` 的 `exports` 加载前两个，舞台页的 `index.html` 直接引 `/stage.js`，所以别改。
`tools/*.ts` 那些一次性的开发脚本还是用 `npx esbuild` 打包（见各脚本开头的用法），和插件构建无关。

开发 watch 使用固定的共享 chunk 文件名，让 HMR 能沿已加载的模块依赖同时替换根插件和 agent，避免两边拿到不同的运行时。
正式构建仍使用带 hash 的 chunk 文件名；切换正式构建和开发 watch 后，重新启动一次 DSH。

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

## 舞台收支

控制台「设置 → 余额与礼物收入」填写初始 API 余额并保存。剩余余额按初始金额减去累计模型费用估算，不是官方账户余额；礼物收入单独统计，不抵扣模型费，也不包含平台分成后的结算。

模型费按 DeepSeek V4.1 Flash 的官方人民币费率计算：每百万 token，高峰缓存命中输入 ¥0.04、未缓存输入 ¥2、输出 ¥8，空闲时段半价。北京时间周一至周五 9–12、14–18 点为高峰，节假日除外；当前节假日日历覆盖 2026 年。DSH 的 `inputTokens` 已是未命中输入，缓存读取另计。其他未支持的模型只统计 token，不扣入余额；配音费也不在该余额中扣减。价格来源：[DeepSeek 官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。

价格规则必须选择「礼物消息」或「弹幕文本」，同名不同来源可配置不同单价。礼物按单价乘数量，未配置时采用平台面值；弹幕仅完整匹配文本时计一次。连击按新增金额计入，模拟事件不入账。改价只影响之后的新事件。

设置保存在 `$DSH_HOME/dsh-livestream/settings.json`，账本保存在同目录的 `finance.json`。按北京时间区分每日费用、礼物收入和弹幕规则收入；历史累计扣费、余额和去重信息在重启后保留。

## 宿主端

`src/dsh/`、`src/body/`、`src/core/` 编译进 `lib/index.js` / `lib/agent.js`，由 DSH 宿主进程加载。
按照框架的 [HMR 接入方式](https://deepseek-harness.github.io/deepseek-harness/develop/framework/#hmr-热模块替换)，
开发 patch 启用 base 组合包已有的 `hmr` 条目（`@deepseek-ai/dsh-hmr`），监听插件的 `lib/`。
DSH base 同时提供它依赖的 `timer` 服务；单独组装 Cordis 的宿主还需要加载 timer 和 loader。

保存源码后，tsdown 重建，HMR 将 300ms 内的变动合并，再替换受影响的宿主插件。
`.map`、`client.js`、`stage.js` 不触发宿主重载，两个页面继续使用各自已有的热更新。
卸载时会停止轮询、点歌播放和旧的控制台事件流，释放 OBS 连接，并等舞台端口关闭后再启动新实例。

宿主 HMR 用于开发调试：舞台连接会重建，点歌队列会清空，已有的断点续播逻辑会尝试恢复直播会话。
正式运行用 `pnpm build`，启动时去掉这份开发 patch。它只在 `dev` 下生成，正式构建会清掉它。

正常重载时 DSH 日志会出现 `reload plugin at ...`；没有加载开发 patch 时，宿主代码仍需要手动重启 DSH。

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
- 抖音连接被拒（日志里是「抖音拒绝了连接（HTTP 200，不是 101）」）：签名脚本失效了——
  抖音改版后 `third_party/douyin-sign/sign.js` 会过期。按该目录 README 换成上游新版本，
  同时改 `src/core/platforms/douyin/douyinSign.ts` 里的 sha256。也可以临时用
  `DSH_DOUYIN_SIGN_FILE=<新文件路径>` 试，不用重新构建。
- 抖音没有礼物：礼物只推给登录态的连接。控制台会提示「收不到礼物」；填一份含
  `sessionid_ss` 的抖音 Cookie（DSH 凭据 `DOUYIN_COOKIE`）后重连。
- 点歌没反应：先看控制台「点歌」是不是开着，再确认 OBS 舞台浏览器源已打开。
  搜索走 `music.163.com/api/search/get`，音源走 `api/song/enhance/player/url`，由舞台服务器的
  `/music?seq=…&token=…` 转发音频（支持 Range），无需桌面客户端或辅助功能权限。
- 点歌显示「等待舞台播放」：控制台预览 `?preview=1` 保持静音、不发播放回执。请打开正式舞台页；
  普通浏览器可能拦截自动播放，点击舞台上的「开启声音」。OBS 的浏览器源应开启音频输出。
- 点歌显示「播放失败」：检查网络和具体错误。可在控制台保存 DSH 凭据 `NETEASE_COOKIE`，
  使用该账号有权播放的完整音源；无版权、无权限或只有试听会明确报错，可手动跳过后重新点歌。
  音源只在轮到这首时获取，Cookie 和上游音频地址不发到舞台。
- 点歌进度与自动切歌：舞台音频通过 `/music/state` 上报真实播放、暂停、缓冲、结束和错误。
  只有收到播放回执才显示「正在播放」，收到 `ended` 才自动换歌，不按歌曲时长猜测。
  舞台断线时暂停，重连按最近一次回传的位置续播；跳歌后旧歌曲的回执会被忽略。
- 点歌总说「没有这首歌」：网易云没有那首歌的版权时确实搜不到（例如很多周杰伦原唱）。
  搜到的是同名翻唱时会照实报歌手名。让观众把歌名或歌手写全一点再试。
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
- 宿主端不热更新：先确认运行的是 `dev`，启动命令加载了 `lib/cordis.hmr.patch.yml`，
  且 DSH 日志里 `hmr watching` 的路径是当前 checkout 的 `lib/`。切换构建模式后重启一次 DSH。
  报 `--expose-internals is required for HMR service` 时，使用 DSH 自带的启动器启动。
- 改了 `tsdown.config.ts`、`build/config.ts`、`package.json`、`cordis.patch.yml`：重启 `pnpm dev`；
  `package.json` 的改动还要重启 DSH。

## 角色素材

角色包在 `packages/dsh-livestream/assets/characters/<id>/`：`character.json` 写用哪些片段和插画，
其余文件由舞台服务器按 `/characters/<id>/<文件>` 直接发出去。`clips.size` 是视频原始尺寸，
`clips.frame` 是画面里人物真正占的那一块（舞台按它摆，人物不会缩在 16:9 画幅中间）。

「大肥鱼·Q版」（`dafeiyu-chibi`）的素材是整包从社区项目搬来的，短名对照、每个文件接在哪里，见
[`assets/characters/dafeiyu-chibi/ACTIONS.md`](../packages/dsh-livestream/assets/characters/dafeiyu-chibi/ACTIONS.md)。
