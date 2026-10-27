# 抖音直播采集方案

计划文档，不是已实现的功能。写清楚"数据从哪来、映射成什么、仓库要改哪几处、怎么验收"，
以及为什么第一步是 spike 而不是写代码。

## 结论

接入点早就留好了：`src/core/platforms/source.ts:15` 的 `LiveSource`（`platform` / `start` / `stop`）
加 `src/core/platforms/index.ts:9` 的工厂。抖音只是第二个实现，下游（注意力、记忆、舞台、控制台）
一行都不用改。

采集链路已经跑通（见第七节的实测记录）。两个前提的处理结果：

1. **wss 的 `signature`**：必须用社区的签名脚本（AGPL，不放进本仓库，运行时下载并校验缓存）。
   官方 CDN 的 webmssdk 算出来的签名服务端不认。
2. **礼物必须登录**：抖音只向**已登录**的连接推礼物消息；游客态只有弹幕、进场、点赞。
   所以控制台要留一份抖音 Cookie（`DOUYIN_COOKIE`）。没填也能播，只是没有礼物。

抖音的推流不用管：主人用抖音直播伴侣开播，插件只采弹幕（`live.douyin.com/<房间号>` 那串数字）。

## 一、目标与非目标

采集（进 `LiveEvent`）：

| 需求 | 抖音消息 |
|---|---|
| 弹幕 | `WebcastChatMessage` |
| 礼物 | `WebcastGiftMessage` |
| 进场 | `WebcastMemberMessage` |
| 点赞 | `WebcastLikeMessage` |
| 关注 / 分享 | `WebcastSocialMessage` |
| 在线人数、累计观看 | `WebcastRoomUserSeqMessage`、`WebcastRoomStatsMessage` |
| 下播 | `WebcastControlMessage`（status=3） |
| 粉丝团 | `WebcastFansclubMessage` |

不做：发弹幕、房管（禁言/踢人）、开播与推流、礼物榜、连麦。B 站那侧对应的 `biliSocial`
（私信、动态、投币）在抖音没有等价物，也就不在范围内。

## 二、数据从哪来

真实链路（`web_rid` 是用户填的那个短号，`room_id` 是内部 id）：

```
用户填 web_rid（如 708764876300，字符串）
  ↓ GET https://live.douyin.com/<web_rid>   （带 ttwid）
页面里取内部 room_id（19 位，如 7392091211001140287）
  ↓ cookie 三件套：ttwid / __ac_nonce / __ac_signature
wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/?…&room_id=<room_id>&signature=<X-Bogus>
  ↓ 服务端推 PushFrame
PushFrame.payload(8) → gzip 解压 → Response(protobuf)
  ↓ Response.messagesList(1)
Message{ method(1), payload(2) } → 按 method 解具体消息体
```

配套的三件事：

- **心跳**：每 5 秒发一个 `PushFrame{payloadType:"hb"}`，以 WebSocket PING 帧发出。
- **应答**：`Response.needAck(9)` 为真时回 `PushFrame{logId, payloadType:"ack", payload:internalExt}`，
  不回的话服务端会断。
- **服务器地址**：host 是 `webcast*-ws-web-*.douyin.com` 这类，可以硬编码几台 + 失败轮换，
  和 `biliSource` 现在换弹幕服务器的结构一样。

`Response` / `PushFrame` / `Message` 的字段号已经拿到（`Response.messagesList`=1、`needAck`=9、
`internalExt`=5；`PushFrame.payload`=8、`logId`=2、`payloadType`=7），消息体的字段号见第四节。

## 三、两个采集内核，选哪个

| | 轻量直连（纯代码） | 浏览器旁观（Chrome + CDP） |
|---|---|---|
| 原理 | 自己签名、自己连 wss、自己心跳 | 开真实页面，用 CDP 旁听 wss 帧 |
| 抗风控 | 弱（数据中心 IP 容易 `DEVICE_BLOCKED` 415） | 强（完整浏览器指纹，被动旁观） |
| 跟协议变更 | 签名一变就挂，要跟 | 页面自动跟随，几乎不用管 |
| 依赖 | 无 | 要本机 Chrome / Chromium，每房间约 200MB |
| 连接速度 | 秒级 | 3～15 秒 |

**建议：先做轻量直连，浏览器内核留作 P2 兜底。**

理由是本插件的部署形态：DSH 桌面版跑在用户自己机器上、家用 IP、单房间、不是容器，
轻量内核的风控风险最小；而让一个 DSH 插件去拉 Chromium 是过重的依赖（插件现在是零运行时
依赖、全部打包进 `lib/`）。真被拦了，再按 `DouyinBrowserSource` 补浏览器内核——接口一样，
换的是实现，`platforms/index.ts` 里加一个分支。

注意：**两个内核的解码层是共用的**（`PushFrame → Response → Message`），浏览器内核只是
换掉"帧从哪来"。所以解码器和映射表现在就该按"只依赖 Buffer"来写。

## 四、字段映射

`LiveUser`：

| 目标字段 | 抖音 |
|---|---|
| `id` | `User.idStr`(1028) 优先，退化到 `User.id`(1) 的 bigint→字符串 |
| `name` | `User.nickName`(3) |
| `face` | `User.avatarThumb`(9).`urlListList`(1) 第一张 |
| `medal` | `User.fansClub`(24) → `data.clubName`(1) / `level`(2)，`ofThisRoom` 由 clubName 是否属于本房间主播判定（拿不到就当 true） |
| `guardLevel` | 抖音没有"大航海"，留空 |
| `isAdmin` | 消息里没有可靠标志，留空 |

`ChatMessage`：`content`(3) → `LiveChatEvent.text`；`common.createTime`(4) → `ts`；
`common.msgId`(2) → `id`。`EmojiChatMessage`（`emojiId`(3)、`defaultContent`(5)）先映射成
`emoteOnly: true` 的 chat，表情图 URL 的拼法待实测确认，确认不了就不给 `stickerUrl`。

`GiftMessage`：`gift.name`(15→16) → `giftName`；`comboCount`(6) / `repeatCount`(5) → `count`；
`gift.diamondCount`(15→12) → 价值；`groupId`(11) + `giftId`(2) → 合并键。

`MemberMessage` → `enter`；`LikeMessage.count`(2) → `like`；`SocialMessage.action`(4)
→ `follow` / `share`（1=关注、2=分享，具体取值实测确认，未知的忽略）。

`RoomUserSeqMessage`：`total`(3) → `stats.online`，`totalPvForAnchor`(11) → `stats.watched`；
`LikeMessage.total`(3) → `stats.likes`；`ControlMessage.status`(2)=3 → `stats.live = false`。

**礼物价值口径**：`diamondCount` 是每份的抖币数，1 元 = 10 抖币，所以
`valueYuan = diamondCount × count ÷ 10`。这和 B 站 `biliDecode.ts:147` 的
`giftValueYuan` 是同一口径——**面值**（观众花的钱），不是主播到手（平台要抽成）。
两个平台放在一起统计才不会被抽成差异带偏。

`LiveSuperChatEvent` 抖音暂时用不上：Web 端没有和 B 站"醒目留言"对等的消息类型。
高价值礼物下游按 `valueYuan` 自己判断即可。

## 五、六个坑

1. **礼物要登录**。游客连接只推弹幕/进场/点赞。控制台必须有"抖音 Cookie"输入，
   `SECRETS` 里加一条（`src/dsh/runtime.ts:111` 现在只有 `BILIBILI_COOKIE`）。
2. **连击合并**。同一次连击会推多条 `WebcastGiftMessage`：`msgId` 各不相同、`groupId` 相同，
   还有一条 `repeatEnd=1` 的收尾消息。要按 `giftId + groupId` 归并、取 `repeatCount` 的**增量**，
   并忽略已见过的收尾消息，否则一次连击会被记成十几次送礼。
   `LiveHub` 现在按事件 `id` 合并（`src/core/hub.ts` 的 `ingest`），所以解码器要发同一个 `id`。
3. **int64 不能过 Number**。观众 id、`room_id` 都是 19 位左右，超过 `Number.MAX_SAFE_INTEGER`。
   解码必须用 bigint 再转字符串——现成的 `src/core/platforms/bilibili/protobuf.ts` 的 `readPb`
   就是 bigint，把它提到 `src/core/` 共用即可。
4. **`roomId` 现在是 `number`**。`LiveConnection.roomId: number`（`src/core/live.ts:126`）
   装不下抖音的 id，得改成 `string`。这是本方案里唯一的破坏性改动，迁移面见下一节。
5. **风控**。cookie 三件套不全会 `DEVICE_BLOCKED`（415）。请求要带完整的 UA、Referer、
   `browser_platform` 等参数，别用默认 UA。
6. **同一账号只能在一个直播间**。多房间共用一个登录 Cookie 会互相踢掉。
   本插件一次只连一个房间，天然规避；但用户切换房间时必须断开重连、不能复用连接。

## 六、仓库改动

**共通层（小改）**

- `src/core/live.ts:6`：`LivePlatform` 加 `'douyin'`。
- `src/core/live.ts:126`：`roomId: number` → `string`。迁移面：
  `src/body/show.ts:226,253`、`src/dsh/index.ts:146,183,232`、`src/dsh/runtime.ts:35,143,335`、
  `src/console/console.tsx:77,92,282,305`（`Number(room)` 去掉），以及 `settings.ownRooms: number[]`
  → `string[]`。B 站内部仍然按数字用，进 `BiliLiveSource` 前 `Number()` 一次。
- `src/core/platforms/bilibili/protobuf.ts` → 提到 `src/core/protobuf.ts`，两个平台共用。
- `src/dsh/runtime.ts:111`：`SECRETS` 加 `douyinCookie: 'DOUYIN_COOKIE'`。

**抖音适配器（新目录 `src/core/platforms/douyin/`）**

| 文件 | 职责 |
|---|---|
| `douyinApi.ts` | 取 cookie 三件套、解析内部 `room_id`、拿主播昵称/房间标题/开播状态 |
| `douyinSign.ts` | `signature`（wss）与 `a_bogus`（HTTP）签名，见下 |
| `douyinProtocol.ts` | `PushFrame` / `Response` / `Message` 的编解码、心跳帧、ack 帧 |
| `douyinDecode.ts` | method → `LiveEvent` 的映射（第四节那张表） |
| `douyinSource.ts` | `LiveSource` 实现：连接、5 秒心跳、70 秒静默判死、退避重连（照 `biliSource.ts` 的结构） |

签名脚本怎么来，是方案里唯一的灰色地带：

- 抖音的签名在网页的 `webmssdk.js` 里，几百 KB 混淆代码，**不随包分发**：
  首次使用时从 live.douyin.com 抓当前版本、缓存到 `$DSH_HOME/dsh-livestream/douyin/`，
  用 `node:vm` 执行算签名。好处是自动跟随抖音改版，也不背上第三方脚本的许可问题；
  坏处是首次要联网、脚本本身还可能被进一步加固。
- 备选是内置一份社区维护的签名脚本。省事，但要接受两点：一是许可（几个流行实现是 AGPL，
  抄进来会传染本仓库的 MIT），二是抖音一改签名就失效，得等上游更新。

## 七、握手验证记录（2026-10-27 实测，已跑通）

| 环节 | 结果 | 说明 |
|---|---|---|
| 取 `ttwid` / `__ac_nonce` | ✅ | `www.douyin.com` → `live.douyin.com` 两跳，Set-Cookie 里都有 |
| `__ac_signature` | ✅ | 用站点 + UA + 秒级时间戳现算（移植自上游 `ac_signature.py`），20 个字符 |
| 解析内部 `room_id` | ✅ | 直播间 HTML 里 `roomId` 正则命中；web_rid `42647162882` → room_id `7701223924599966490` |
| 签名入参 | ✅ | `user_unique_id` 填的是 **room_id**，不是设备 id；`ac=` 留空 |
| 签名算法 | ✅ | `md5(参数串)` → SDK 的 `X-MS-STUB` 出口 → `X-Bogus` |
| wss 升级 | ✅ `101` | `webcast100-ws-web-lq.douyin.com`，随后收到 `Response`（每帧 2～13 条消息） |
| 心跳 / ack | ✅ | 5 秒 `payloadType=hb`；`needAck` 时回 `payloadType=ack` + `internalExt` |
| 实际收到的事件 | ✅ | `WebcastChatMessage`、`WebcastMemberMessage`、`WebcastLikeMessage`、`WebcastSocialMessage`、`WebcastFansclubMessage`、`WebcastRoomUserSeqMessage` |

三个坑，都是实测踩出来的：

1. **官方 CDN 的 webmssdk 算不出能用的签名**。`c-webmssdk/1.0.0.53/webmssdk.es5.js` 能跑起来、
   `frontierSign({"X-MS-STUB": md5})` 也返回 `X-Bogus`，但服务端一律回 **HTTP 200（不是 101）**。
   能用的那份是社区对 webmssdk 做过封装的产物（`frontierSign({"X-MS-STUB": md5})`)。
2. **cookie 三件套缺一不可**。只带 `ttwid` 连接会被拒；补上 `__ac_nonce` + `__ac_signature` 才通过。
3. **签名里的 `+` 必须百分号编码**。签名形如 `Rp8z6ZmDtZZtR+rQ`，直接拼进 query 会被解析成空格。

### 签名脚本：已内置，开箱即用

能用的那份签名脚本在 [`third_party/douyin-sign/sign.js`](../packages/dsh-livestream/third_party/douyin-sign/sign.js)，
随插件分发，**第一次运行不需要联网下载**。加载顺序：

1. `DSH_DOUYIN_SIGN_FILE` 指定的文件（换版本、自托管）
2. 包内自带的 `third_party/douyin-sign/sign.js`（默认走这条）
3. `$DSH_HOME/dsh-livestream/douyin/sign.js` 缓存
4. 都没有才按固定提交下载并校验

第 2 步会核对 sha256（`81fb78a5…`），对不上直接报错，不会拿一份被改过的脚本去签名。
`third_party/douyin-sign/README.md` 记了来源、提交号、校验和与升级方法。

### 许可：这个目录是 AGPL-3.0，仓库其余是 MIT

`sign.js` 来自 `saermart/DouyinLiveWebFetcher`（AGPL-3.0）。处理方式是**独立存放、原样保留**：
该目录带自己的 `LICENSE` 全文，不改代码、不并进 MIT 源码、不打进构建产物
（`lib/chunks/*.js` 里只有读文件的逻辑，实测产物 369 KB，没有内联那 485 KB）。

需要知道的后果：AGPL 是强 copyleft。**自用不受影响**；但一旦把本仓库**对外分发**
（发安装包、开源分发、做成 SaaS），AGPL 的传染性会覆盖到分发行为，需要法务确认。
不想承担的话有两条替代路：删掉 `third_party/douyin-sign/`（会自动退回下载模式），
或改走浏览器内核（第三节 P2），用 CDP 旁听页面已建立的连接，完全不需要签名脚本，代价是要有 Chrome。

实现与验证：

| 文件 | 内容 |
|---|---|
| `src/core/protobuf.ts` | protobuf 读写器，B 站和抖音共用 |
| `src/core/platforms/douyin/douyinProto.ts` | `PushFrame`/`Response` 解包、gzip、心跳帧、ack 帧 |
| `src/core/platforms/douyin/douyinApi.ts` | cookie 链、`__ac_signature`、房间解析、签名入参、wss 地址 |
| `src/core/platforms/douyin/douyinSign.ts` | 签名脚本的加载与缓存 |
| `src/core/platforms/douyin/douyinDecode.ts` | method → `LiveEvent`（19 位 id 走 bigint、连击只发增量） |
| `src/core/platforms/douyin/douyinSource.ts` | `LiveSource` 实现：连接、心跳、ack、静默判死、退避重连 |

测试：`test/douyinDecode.test.ts`（9 个，自造 protobuf 帧）、`test/douyinApi.test.ts`（5 个，
签名入参与 wss 地址形状）、`test/douyinSign.test.ts`（4 个，内置脚本存在、离线可签、
校验和不符会拒绝）；`test/douyinLive.e2e.test.ts` 默认跳过，复验时用
`DSH_DOUYIN_E2E_ROOM=42647162882 pnpm test`（清空 `DSH_HOME` 也能连通，说明没有回退去下载）。

## 八、验收

沿用仓库已有的"录制回放"测试约定（`test/decode.test.ts`）：

- `test/fixtures/douyin/*.jsonl`：把真实房间收到的 `PushFrame` 存成 base64 一行一条，
  `describe.runIf(hasFixtures)` 跑解码，断言各类事件条数、礼物连击合并后的数量、
  int64 id 没被截断。fixtures 不进仓库时测试自动跳过，和 B 站那套一致。
- 连接层的单元测试：喂假的 `Response`，断言 `needAck` 时回了 ack、静默 70 秒会重连。
- 真房间冒烟（手动）：连 3 分钟，看弹幕/礼物/进场都有、控制台舞台上的弹幕姬不报错；
  拔网线重连一次；下播房间能进 `stats.live=false`。
- 回归：B 站的 148 个测试必须全绿（`pnpm -C packages/dsh-livestream test`）。

## 九、风险与合规

- 签名是逆向来的，抖音随时可能改。这是长期维护成本，不是一次性投入。评估时按"每季度可能要修一次"算。
- 风控会封 IP、封号。只用用户自己的 Cookie，不做批量、不做多账号。
- 只采自有或已获授权的直播间；只读，不发送任何业务请求。
- 抖音开放平台有正式的直播开放能力，但需要企业资质和接入审核，不适合本插件的个人用户形态。
