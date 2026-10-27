# 大肥鱼·Q版：素材清单

素材搬自 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)（许可与署名见 [LICENSE.md](LICENSE.md)）。
搬过来时把中文文件名换成了 ASCII 短名（部署到 Windows 时 tar/scp 不会把文件名弄乱），文件内容没动。
节点里的用法写在 [`character.json`](character.json)：`clips` 选表情和循环，`art` 选插画。

片段是 16:9（640×360）的全身构图，人物只占画面中间一块，所以 `clips.frame` 写的是取景框
`[150, 10, 370, 345]`：舞台挂件按这一块的比例摆，人物不会被画幅拖着缩在中间。

## 动画片段（`clips/`，共 106 段）

| 短名 | 原文件名 | 用法 |
|---|---|---|
| `animals-around` | 动物环绕 | 备用（还没接进舞台） |
| `balance-coins-jingle` | 余额-金袋叮当 | 备用（还没接进舞台） |
| `balance-counting-frown` | 余额-数金皱眉 | 备用（还没接进舞台） |
| `balance-drained` | 余额-袋空如洗 | 备用（还没接进舞台） |
| `balance-empty` | 余额-分文不剩 | 备用（还没接进舞台） |
| `balance-normal` | 余额-钱袋如常 | 备用（还没接进舞台） |
| `balance-overflow` | 余额-钱袋满溢 | 备用（还没接进舞台） |
| `become-dove` | 变鸽子 | 备用（还没接进舞台） |
| `big-stretch` | 超大伸懒腰 | 备用（还没接进舞台） |
| `blow-balloon` | 吹气球 | 备用（还没接进舞台） |
| `blue-whale` | 蓝鲸现世 | 备用（还没接进舞台） |
| `brush-teeth` | 晨间刷牙 | 备用（还没接进舞台） |
| `build-snowman` | 堆雪人 | 备用（还没接进舞台） |
| `buried-leaves` | 被落叶淹没 | 备用（还没接进舞台） |
| `butterflies-bloom` | 蝴蝶蜜蜂环绕头顶开花 | 备用（还没接进舞台） |
| `card-magic` | 扑克魔术 | 备用（还没接进舞台） |
| `chrysanthemum-day` | 插茱萸赏菊 | 备用（还没接进舞台） |
| `click-happy` | 点击回应-开心跃动 | 表情 laugh（笑） |
| `click-pout` | 点击回应-傲娇生气 | 表情 angry（气鼓鼓） |
| `click-shy` | 点击回应-害羞惊讶 | 表情 shy（害羞） |
| `click-tickle` | 点击回应-挠痒咯咯笑 | 备用（还没接进舞台） |
| `click-wave` | 点击回应-元气挥手 | 备用（还没接进舞台） |
| `conjure-flowers` | 凭空生花 | 备用（还没接进舞台） |
| `crab-walk` | 螃蟹走路 | 备用（还没接进舞台） |
| `cute-dance` | 可爱宅舞 | 备用（还没接进舞台） |
| `cute-ghost` | 萌化小幽灵 | 备用（还没接进舞台） |
| `decorate-christmas` | 装点圣诞树 | 备用（还没接进舞台） |
| `deep-thought` | 深度思考碎碎念 | 备用（还没接进舞台） |
| `drag-hover` | 被鼠标拖拽悬空反馈 | 备用（还没接进舞台） |
| `eat-breakfast` | 吃早餐 | 备用（还没接进舞台） |
| `eat-chongyang-cake` | 吃重阳糕 | 备用（还没接进舞台） |
| `eat-crab` | 吃大闸蟹 | 备用（还没接进舞台） |
| `eat-dinner` | 吃晚餐 | 备用（还没接进舞台） |
| `eat-dumplings` | 吃饺子 | 备用（还没接进舞台） |
| `eat-laba-porridge` | 吃腊八粥 | 备用（还没接进舞台） |
| `eat-longevity-noodles` | 吃长寿面 | 备用（还没接进舞台） |
| `eat-lunch` | 吃午餐 | 备用（还没接进舞台） |
| `eat-qingtuan` | 吃青团 | 备用（还没接进舞台） |
| `eat-rice` | 吃白饭 | 备用（还没接进舞台） |
| `eat-ricecake` | 吃年糕 | 备用（还没接进舞台） |
| `eat-tanghulu` | 吃糖葫芦 | 备用（还没接进舞台） |
| `eat-tangyuan` | 吃汤圆 | 备用（还没接进舞台） |
| `eat-token` | 吃Token | 备用（还没接进舞台） |
| `eat-watermelon` | 吃西瓜 | 备用（还没接进舞台） |
| `eat-zongzi` | 吃粽子 | 备用（还没接进舞台） |
| `fan-cool` | 摇扇纳凉 | 备用（还没接进舞台） |
| `fireworks` | 放烟花 | 备用（还没接进舞台） |
| `float-steps` | 原地漂浮踏步 | 备用（还没接进舞台） |
| `fly-kite` | 放风筝 | 备用（还没接进舞台） |
| `game-rage` | 玩游戏气急败坏 | 备用（还没接进舞台） |
| `hotpot` | 涮火锅 | 备用（还没接进舞台） |
| `hum-song` | 悠闲哼歌 | 备用（还没接进舞台） |
| `icecream-melt` | 吃冰淇淋融化 | 备用（还没接进舞台） |
| `idle-breathe` | 待机呼吸休闲 | 待机循环（不说话时） |
| `juggle-balls` | 三球抛接 | 备用（还没接进舞台） |
| `jump-grab` | 原地跳跃抓碎头顶物品 | 备用（还没接进舞台） |
| `kick-shuttlecock` | 踢毽子 | 备用（还没接进舞台） |
| `lion-dance` | 舞狮头 | 备用（还没接进舞台） |
| `look-around` | 东张西望 | 备用（还没接进舞台） |
| `look-mirror` | 照镜子 | 备用（还没接进舞台） |
| `maid-curtsy` | 女仆屈膝礼仪 | 备用（还没接进舞台） |
| `maid-dance` | 优雅女仆舞 | 备用（还没接进舞台） |
| `mooncake-midautumn` | 中秋赏月吃月饼 | 备用（还没接进舞台） |
| `munch-snacks` | 大口吃零食 | 备用（还没接进舞台） |
| `mutter-daze` | 碎碎念-发呆碎碎念 | 备用（还没接进舞台） |
| `mutter-screen` | 碎碎念-对屏碎碎念 | 说话循环（开口时） |
| `mutter-wipe` | 碎碎念-擦桌碎碎念 | 备用（还没接进舞台） |
| `nap-sleep` | 原地小憩沉眠 | 备用（还没接进舞台） |
| `needle-qixi` | 穿针乞巧 | 备用（还没接进舞台） |
| `note-taking` | 轻快记录 | 备用（还没接进舞台） |
| `pet-cat` | 撸猫 | 备用（还没接进舞台） |
| `play-flute` | 吹笛子 | 备用（还没接进舞台） |
| `play-gomoku` | 下五子棋 | 备用（还没接进舞台） |
| `play-violin` | 小提琴演奏 | 备用（还没接进舞台） |
| `receive-redpacket` | 收红包 | 备用（还没接进舞台） |
| `river-lantern` | 放河灯 | 备用（还没接进舞台） |
| `rocking-horse` | 骑木马 | 备用（还没接进舞台） |
| `rubiks-cube` | 原地专心玩魔方 | 备用（还没接进舞台） |
| `run-in-place` | 原地左转奔跑 | 备用（还没接进舞台） |
| `sky-lantern` | 放孔明灯 | 备用（还没接进舞台） |
| `snack-caught` | 偷吃零食被抓住 | 备用（还没接进舞台） |
| `spin-360` | 小幅度原地360度旋转展示 | 备用（还没接进舞台） |
| `spin-top` | 抽陀螺 | 备用（还没接进舞台） |
| `squash-squat` | 原地重力下蹲压缩 | 备用（还没接进舞台） |
| `startled-awake` | 打瞌睡被惊醒 | 表情 scared（害怕） |
| `startled-jump` | 被吓一跳 | 表情 shocked（吓一跳） |
| `swing` | 荡秋千 | 备用（还没接进舞台） |
| `swing-dance` | 轻快摇摆舞 | 备用（还没接进舞台） |
| `tail-slap` | 用鲸鱼尾巴拍打地面 | 备用（还没接进舞台） |
| `tap-desk` | 原地敲击桌面互动 | 备用（还没接进舞台） |
| `toy-car` | 原地蹲下玩玩具汽车 | 备用（还没接进舞台） |
| `trick-or-treat` | 讨糖南瓜灯 | 备用（还没接进舞台） |
| `try-outfits` | 整体换装试色 | 备用（还没接进舞台） |
| `type-code` | 写代码 | 备用（还没接进舞台） |
| `unwrap-gift` | 拆礼物 | 备用（还没接进舞台） |
| `water-gun` | 玩水枪 | 备用（还没接进舞台） |
| `whale-bubbles` | 鲸鱼吐泡泡特效 | 备用（还没接进舞台） |
| `what-to-eat` | 是啊，吃什么 | 备用（还没接进舞台） |
| `work-celebrate` | 工作状态-雀跃庆祝 | 备用（还没接进舞台） |
| `work-pace` | 工作状态-原地踱步张望 | 备用（还没接进舞台） |
| `work-sigh-sweat` | 工作状态-垂头叹气冒汗 | 表情 sad（难过） |
| `work-sorting` | 工作状态-清点归档 | 备用（还没接进舞台） |
| `work-thinking` | 工作状态-思考冒泡 | 表情 think（琢磨） |
| `work-typing-busy` | 工作状态-忙碌点按 | 备用（还没接进舞台） |
| `write-fu` | 写福字 | 备用（还没接进舞台） |
| `yawn` | 哈欠连天 | 备用（还没接进舞台） |

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
