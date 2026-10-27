# 大肥鱼·Q版：素材清单

素材搬自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（许可与署名见 [LICENSE.md](LICENSE.md)）。
搬过来时把中文文件名换成了 ASCII 短名（部署到 Windows 时 tar/scp 不会把文件名弄乱），文件内容没动。
节点里的用法写在 [`character.json`](character.json)：`clips` 选表情和循环，`art` 选插画。

片段是 16:9（640×360）的全身构图，人物只占画面中间一块，所以 `clips.frame` 写的是取景框
`[150, 10, 370, 345]`：舞台挂件按这一块的比例摆，人物不会被画幅拖着缩在中间。

原版 `dafeiyu` 与本包的画幅、取景和转场不同，保留为两个可切换的角色包；它们已经统一放在 `characters/` 下。

动画中的七种基础表情沿用原来的标记，其余动作可直接写 `[短名]`；待机和说话循环自动切换。
主播和游戏线会收到当前角色可用标记及中文说明。舞台仅预热常用表情，其余片段按需加载。

## 动画片段（`clips/`，共 106 段）

| 短名 | 原文件名 | 用法 |
|---|---|---|
| `animals-around` | 动物环绕 | 动作 `[animals-around]` |
| `balance-coins-jingle` | 余额-金袋叮当 | 动作 `[balance-coins-jingle]` |
| `balance-counting-frown` | 余额-数金皱眉 | 动作 `[balance-counting-frown]` |
| `balance-drained` | 余额-袋空如洗 | 动作 `[balance-drained]` |
| `balance-empty` | 余额-分文不剩 | 动作 `[balance-empty]` |
| `balance-normal` | 余额-钱袋如常 | 动作 `[balance-normal]` |
| `balance-overflow` | 余额-钱袋满溢 | 动作 `[balance-overflow]` |
| `become-dove` | 变鸽子 | 动作 `[become-dove]` |
| `big-stretch` | 超大伸懒腰 | 动作 `[big-stretch]` |
| `blow-balloon` | 吹气球 | 动作 `[blow-balloon]` |
| `blue-whale` | 蓝鲸现世 | 动作 `[blue-whale]` |
| `brush-teeth` | 晨间刷牙 | 动作 `[brush-teeth]` |
| `build-snowman` | 堆雪人 | 动作 `[build-snowman]` |
| `buried-leaves` | 被落叶淹没 | 动作 `[buried-leaves]` |
| `butterflies-bloom` | 蝴蝶蜜蜂环绕头顶开花 | 动作 `[butterflies-bloom]` |
| `card-magic` | 扑克魔术 | 动作 `[card-magic]` |
| `chrysanthemum-day` | 插茱萸赏菊 | 动作 `[chrysanthemum-day]` |
| `click-happy` | 点击回应-开心跃动 | 表情 laugh（笑） |
| `click-pout` | 点击回应-傲娇生气 | 表情 angry（气鼓鼓） |
| `click-shy` | 点击回应-害羞惊讶 | 表情 shy（害羞） |
| `click-tickle` | 点击回应-挠痒咯咯笑 | 动作 `[click-tickle]` |
| `click-wave` | 点击回应-元气挥手 | 动作 `[click-wave]` |
| `conjure-flowers` | 凭空生花 | 动作 `[conjure-flowers]` |
| `crab-walk` | 螃蟹走路 | 动作 `[crab-walk]` |
| `cute-dance` | 可爱宅舞 | 动作 `[cute-dance]` |
| `cute-ghost` | 萌化小幽灵 | 动作 `[cute-ghost]` |
| `decorate-christmas` | 装点圣诞树 | 动作 `[decorate-christmas]` |
| `deep-thought` | 深度思考碎碎念 | 动作 `[deep-thought]` |
| `drag-hover` | 被鼠标拖拽悬空反馈 | 动作 `[drag-hover]` |
| `eat-breakfast` | 吃早餐 | 动作 `[eat-breakfast]` |
| `eat-chongyang-cake` | 吃重阳糕 | 动作 `[eat-chongyang-cake]` |
| `eat-crab` | 吃大闸蟹 | 动作 `[eat-crab]` |
| `eat-dinner` | 吃晚餐 | 动作 `[eat-dinner]` |
| `eat-dumplings` | 吃饺子 | 动作 `[eat-dumplings]` |
| `eat-laba-porridge` | 吃腊八粥 | 动作 `[eat-laba-porridge]` |
| `eat-longevity-noodles` | 吃长寿面 | 动作 `[eat-longevity-noodles]` |
| `eat-lunch` | 吃午餐 | 动作 `[eat-lunch]` |
| `eat-qingtuan` | 吃青团 | 动作 `[eat-qingtuan]` |
| `eat-rice` | 吃白饭 | 动作 `[eat-rice]` |
| `eat-ricecake` | 吃年糕 | 动作 `[eat-ricecake]` |
| `eat-tanghulu` | 吃糖葫芦 | 动作 `[eat-tanghulu]` |
| `eat-tangyuan` | 吃汤圆 | 动作 `[eat-tangyuan]` |
| `eat-token` | 吃Token | 动作 `[eat-token]` |
| `eat-watermelon` | 吃西瓜 | 动作 `[eat-watermelon]` |
| `eat-zongzi` | 吃粽子 | 动作 `[eat-zongzi]` |
| `fan-cool` | 摇扇纳凉 | 动作 `[fan-cool]` |
| `fireworks` | 放烟花 | 动作 `[fireworks]` |
| `float-steps` | 原地漂浮踏步 | 动作 `[float-steps]` |
| `fly-kite` | 放风筝 | 动作 `[fly-kite]` |
| `game-rage` | 玩游戏气急败坏 | 动作 `[game-rage]` |
| `hotpot` | 涮火锅 | 动作 `[hotpot]` |
| `hum-song` | 悠闲哼歌 | 动作 `[hum-song]` |
| `icecream-melt` | 吃冰淇淋融化 | 动作 `[icecream-melt]` |
| `idle-breathe` | 待机呼吸休闲 | 待机循环（不说话时） |
| `juggle-balls` | 三球抛接 | 动作 `[juggle-balls]` |
| `jump-grab` | 原地跳跃抓碎头顶物品 | 动作 `[jump-grab]` |
| `kick-shuttlecock` | 踢毽子 | 动作 `[kick-shuttlecock]` |
| `lion-dance` | 舞狮头 | 动作 `[lion-dance]` |
| `look-around` | 东张西望 | 动作 `[look-around]` |
| `look-mirror` | 照镜子 | 动作 `[look-mirror]` |
| `maid-curtsy` | 女仆屈膝礼仪 | 动作 `[maid-curtsy]` |
| `maid-dance` | 优雅女仆舞 | 动作 `[maid-dance]` |
| `mooncake-midautumn` | 中秋赏月吃月饼 | 动作 `[mooncake-midautumn]` |
| `munch-snacks` | 大口吃零食 | 动作 `[munch-snacks]` |
| `mutter-daze` | 碎碎念-发呆碎碎念 | 动作 `[mutter-daze]` |
| `mutter-screen` | 碎碎念-对屏碎碎念 | 说话循环（开口时） |
| `mutter-wipe` | 碎碎念-擦桌碎碎念 | 动作 `[mutter-wipe]` |
| `nap-sleep` | 原地小憩沉眠 | 动作 `[nap-sleep]` |
| `needle-qixi` | 穿针乞巧 | 动作 `[needle-qixi]` |
| `note-taking` | 轻快记录 | 动作 `[note-taking]` |
| `pet-cat` | 撸猫 | 动作 `[pet-cat]` |
| `play-flute` | 吹笛子 | 动作 `[play-flute]` |
| `play-gomoku` | 下五子棋 | 动作 `[play-gomoku]` |
| `play-violin` | 小提琴演奏 | 动作 `[play-violin]` |
| `receive-redpacket` | 收红包 | 动作 `[receive-redpacket]` |
| `river-lantern` | 放河灯 | 动作 `[river-lantern]` |
| `rocking-horse` | 骑木马 | 动作 `[rocking-horse]` |
| `rubiks-cube` | 原地专心玩魔方 | 动作 `[rubiks-cube]` |
| `run-in-place` | 原地左转奔跑 | 动作 `[run-in-place]` |
| `sky-lantern` | 放孔明灯 | 动作 `[sky-lantern]` |
| `snack-caught` | 偷吃零食被抓住 | 动作 `[snack-caught]` |
| `spin-360` | 小幅度原地360度旋转展示 | 动作 `[spin-360]` |
| `spin-top` | 抽陀螺 | 动作 `[spin-top]` |
| `squash-squat` | 原地重力下蹲压缩 | 动作 `[squash-squat]` |
| `startled-awake` | 打瞌睡被惊醒 | 表情 scared（害怕） |
| `startled-jump` | 被吓一跳 | 表情 shocked（吓一跳） |
| `swing` | 荡秋千 | 动作 `[swing]` |
| `swing-dance` | 轻快摇摆舞 | 动作 `[swing-dance]` |
| `tail-slap` | 用鲸鱼尾巴拍打地面 | 动作 `[tail-slap]` |
| `tap-desk` | 原地敲击桌面互动 | 动作 `[tap-desk]` |
| `toy-car` | 原地蹲下玩玩具汽车 | 动作 `[toy-car]` |
| `trick-or-treat` | 讨糖南瓜灯 | 动作 `[trick-or-treat]` |
| `try-outfits` | 整体换装试色 | 动作 `[try-outfits]` |
| `type-code` | 写代码 | 动作 `[type-code]` |
| `unwrap-gift` | 拆礼物 | 动作 `[unwrap-gift]` |
| `water-gun` | 玩水枪 | 动作 `[water-gun]` |
| `whale-bubbles` | 鲸鱼吐泡泡特效 | 动作 `[whale-bubbles]` |
| `what-to-eat` | 是啊，吃什么 | 动作 `[what-to-eat]` |
| `work-celebrate` | 工作状态-雀跃庆祝 | 动作 `[work-celebrate]` |
| `work-pace` | 工作状态-原地踱步张望 | 动作 `[work-pace]` |
| `work-sigh-sweat` | 工作状态-垂头叹气冒汗 | 表情 sad（难过） |
| `work-sorting` | 工作状态-清点归档 | 动作 `[work-sorting]` |
| `work-thinking` | 工作状态-思考冒泡 | 表情 think（琢磨） |
| `work-typing-busy` | 工作状态-忙碌点按 | 动作 `[work-typing-busy]` |
| `write-fu` | 写福字 | 动作 `[write-fu]` |
| `yawn` | 哈欠连天 | 动作 `[yawn]` |

## 表情包（`art/memes/`，共 27 张）

| 短名 | 原文件名 | 用法 |
|---|---|---|
| `awesome-whale` | 厉害了我的鲸 | 大礼物横幅 |
| `big-burner` | 大烧货 | 终端挂件 |
| `big-pill` | 大的药来了 | 备用（还没接进舞台） |
| `big-thing-coming` | 大的要来啦 | 备用（还没接进舞台） |
| `ciallo` | Ciallo | 新观众进场、关注 |
| `computer-virus` | 哪来的电脑病毒 | 备用（还没接进舞台） |
| `cute` | 可爱 | 开场主视觉（kv） |
| `dead` | 死掉了 | 插件更新时的「更新中」画面 |
| `deep-sleep` | 深度睡眠 | 开播前的等待画面 |
| `deleted-the-butter` | 完蛋了把黄油删了 | 备用（还没接进舞台） |
| `eat-white-rice` | 吃白饭的大肥鱼 | 饭碗计数挂件 |
| `fish-resources` | 鱼片有资源吗 | 备用（还没接进舞台） |
| `full-belly` | 吃饱饱摸肚子 | 下播谢幕画面 |
| `just-one-bowl` | 就一碗 | 备用（还没接进舞台） |
| `just-scold-him` | 要不直接骂他 | 备用（还没接进舞台） |
| `keep-you-anyway` | 先养着吧 | 备用（还没接进舞台） |
| `oh-whale` | 哦鲸鲸 | 备用（还没接进舞台） |
| `only-flirting` | 除了调情没啥用 | 备用（还没接进舞台） |
| `open-source-oath` | 誓死践行开源精神 | 备用（还没接进舞台） |
| `pressure-fish` | 压力一只大肥鱼 | 备用（还没接进舞台） |
| `riemann-meow` | 黎曼猜想没证明喵 | 备用（还没接进舞台） |
| `shock-you` | 电死你 | 备用（还没接进舞台） |
| `so-what` | 就骚了怎么滴吧 | 备用（还没接进舞台） |
| `three-days-multimodal` | 假如给我三天多模态 | 备用（还没接进舞台） |
| `token-for-mom` | token给妈妈保管 | 备用（还没接进舞台） |
| `what-is-this-zone` | 大师这个区是什么意思 | 备用（还没接进舞台） |
| `who-updates-you` | 我不更新你们用什么 | 备用（还没接进舞台） |

## 其他

- `art/notify/`：dsh-pet 的系统通知图标（通知完成 / 出错 / 提问 / 权限 / 截断）和拖拽光标，目前没接进舞台，留着备用。
- `art/logo.png`：dsh-pet 的图标。
- `fonts/shangshou-ruantangti.ttf`：上首软糖体（4 MB）。舞台模板可以在自己的 style.css 里这样引用：

  ```css
  @font-face {
    font-family: "上首软糖体";
    src: url("/characters/dafeiyu-chibi/fonts/shangshou-ruantangti.ttf") format("truetype");
  }
  ```

  模板的 style.css 里写绝对路径时不会被改写成带 token 的地址（只有相对路径会），所以要在地址后面自己带 `?token=`，
  或者把字体复制进模板目录、用相对路径引用。
- dsh-pet 还带了一套每个动作的预览 GIF（`assets/preview/`，106 个、约 64 MB），是上面这些 webm 的缩略预览，
  内容重复，没有搬。需要的话：

  ```bash
  git clone --depth 1 https://github.com/PC2005-cloud/dsh-pet /tmp/dsh-pet
  ls /tmp/dsh-pet/dsh-pet/assets/preview
  ```
