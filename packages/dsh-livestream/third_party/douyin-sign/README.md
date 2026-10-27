# douyin-sign（第三方签名资产）

抖音弹幕连接的 wss `signature`（X-Bogus）是网页端安全 SDK `webmssdk` 算出来的。
抖音会对没有签名或签名不对的连接直接回 HTTP 200（不是 101），而且不说明原因。
官方 CDN 上的 `webmssdk.es5.js`（1.0.0.53）用同样的入参算出来的签名服务端**不认**，
能用的是下面这份封装产物。

| 文件 | 说明 |
|---|---|
| `sign.js` | `webmssdk` 的反混淆封装产物，暴露 `get_sign(md5)` → signature（内部是 `frontierSign({"X-MS-STUB": md5})["X-Bogus"]`） |
| `LICENSE` | 上游许可证全文（AGPL-3.0） |

## 来源

- 上游项目：[saermart/DouyinLiveWebFetcher](https://github.com/saermart/DouyinLiveWebFetcher)
- 固定提交：`40a904bdb0561a5a9c958a95634a29681cc4fbf4`
- 文件：[`sign.js`](https://raw.githubusercontent.com/saermart/DouyinLiveWebFetcher/40a904bdb0561a5a9c958a95634a29681cc4fbf4/sign.js)
- sha256：`81fb78a5e8728af99ffb9d20625b01bcedc43a82b05e3bef79e2bc0d29ccff5d`

固定到提交而不是分支，是为了让内容可复现：`src/core/platforms/douyin/douyinSign.ts`
会校验这个 sha256，对不上就拒绝加载。

## 许可证：AGPL-3.0（与本仓库的 MIT 不同）

`sign.js` 是 **AGPL-3.0**，本仓库其余部分是 MIT。处理方式：

- 这个文件**原样保留，不做任何修改**，单独放在 `third_party/douyin-sign/` 下，附带上游 `LICENSE` 全文。
- 不与 MIT 代码合并、不改编、不内联进构建产物；运行时只通过 `node:vm` 加载并调用它的公共出口。
- 因此本目录是一个独立第三方组件，其条款以本目录的 `LICENSE` 为准。

**这意味着什么**：AGPL 是强 copyleft。如果要把本仓库**分发**给他人（发布安装包、开源分发、
SaaS 形态提供），AGPL 的传染性会影响到分发行为，需要法务确认，或者改用下面两种替代方案：

1. 不内置：删除本目录，`douyinSign.ts` 会退回「首次连接时下载 + 校验」的模式。
2. 浏览器内核：用 CDP 旁听真实页面已经建立的连接，完全不需要签名脚本（需要本机有 Chrome）。

## 维护提示

抖音随时可能更新 webmssdk，签名算法一变这份产物就失效。失效的表现是连接被拒
（HTTP 200 而不是 101）。处理：换上游的新版本，同时更新 `douyinSign.ts` 里的 sha256。
