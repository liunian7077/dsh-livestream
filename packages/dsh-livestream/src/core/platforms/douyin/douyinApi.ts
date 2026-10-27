/**
 * 抖音的 cookie 链与房间解析。
 *
 * 抖音的 Web 风控要求三个 cookie 一起出现，缺任何一个都可能被 415 / 拒连：
 *   ttwid          访问 douyin.com 时下发
 *   __ac_nonce     同上，一次性随机串
 *   __ac_signature 用 __ac_nonce + UA 现算（算法照 DouyinLiveWebFetcher 的 ac_signature.py 移植，
 *                  是几个 32 位乘法哈希拼成 4 段 5 字符的 base64 变体，见 acSignature）
 *
 * 房间：用户填的是 web_rid（直播间地址里的数字），连弹幕要内部 room_id（19 位）。
 * 内部 id 直接从直播间页面 HTML 里取，不需要 a_bogus。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';
const TIMEOUT_MS = 15_000;
const HEADERS = { 'User-Agent': UA, Accept: 'text/html,*/*;q=0.8', 'Accept-Language': 'zh-CN,zh;q=0.9' };

export { UA };

export interface DouyinRoom {
  /** 内部 room_id，19 位，必须当字符串用 */
  roomId: string;
  title?: string;
  anchorName?: string;
}

/**
 * Cookie 里有没有登录态。抖音的登录令牌叫 sessionid / sessionid_ss（Secure 版），
 * sid_tt 是同一套会话的另一份备份；任一存在就认为这条连接是登录态。
 *
 * 注意这只是「字段在不在」，判断不了「是否还有效」——过期表现为弹幕正常但礼物不再推过来。
 */
export function hasLogin(cookie: string | Map<string, string>): boolean {
  const jar = typeof cookie === 'string' ? parseCookie(cookie) : cookie;
  return jar.has('sessionid') || jar.has('sessionid_ss') || jar.has('sid_tt');
}

/** __ac_signature：算法的三个哈希 + 28 字符编码，照 ac_signature.py 移植 */
export function acSignature(site: string, nonce: string, ua: string, ts: number): string {
  void nonce; // 算法本身不掺入 nonce，只用到站点、UA 和时间戳
  const cal1 = (s: string, iv: number) => {
    let k = iv;
    for (const c of s) k = ((k ^ c.charCodeAt(0)) * 65599) & 0xffffffff;
    return k;
  };
  const cal2 = (s: string, iv: number) => {
    let k = iv;
    const a = s.length;
    for (let i = 0; i < 32; i++) {
      k = (k * 65599 + s.charCodeAt(k % a)) & 0xffffffff;
    }
    return k;
  };
  const cal3 = (s: string, iv: number) => {
    let k = iv;
    for (const c of s) k = (k * 65599 + c.charCodeAt(0)) & 0xffffffff;
    return k;
  };
  const chr = (c: number) =>
    c < 26 ? String.fromCharCode(c + 65) : c < 52 ? String.fromCharCode(c + 71) : c < 62 ? String.fromCharCode(c - 4) : String.fromCharCode(c - 17);
  const enc = (n: number) => {
    let s = '';
    for (let i = 24; i >= 0; i -= 6) s += chr((n >> i) & 63);
    return s;
  };
  const s1 = cal1(site, 0);
  const s3 = cal1(site, 0);
  const s5 = cal2(site, 0);
  const s2 = cal2(ua, s1);
  const s4 = cal3(ua, s3);
  const s6 = cal3(ua, s5);
  const s7 = (s1 + s2) & 0xffffffff;
  const s8 = (s3 + s4) & 0xffffffff;
  const s9 = (s5 + s6) & 0xffffffff;
  const s10 = (s7 + s8) & 0xffffffff;
  const s11 = (s8 + s9) & 0xffffffff;
  const s12 = (s10 + s11) & 0xffffffff;
  const s13 = (s1 + s4 + s5 + s7 + s9 + s11) & 0xffffffff;
  const s14 = (s2 + s3 + s6 + s8 + s10 + s12) & 0xffffffff;
  const s15 = (s13 + s14) & 0xffffffff;
  return enc(ts & 0xffffffff) + enc(s12) + enc(s15) + enc(ts & 0xffffffff);
}

/** 一串 Cookie 头拆成表；用户自己贴的 Cookie 也走这里 */
export function parseCookie(cookie: string): Map<string, string> {
  const jar = new Map<string, string>();
  for (const part of cookie.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return jar;
}

const cookieString = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

/**
 * 补齐 cookie：用户给了 Cookie 就用它，只补算 __ac_signature；
 * 没给就匿名跑一遍 cookie 链（www.douyin.com → live.douyin.com）。
 */
export async function ensureCookie(userCookie: string): Promise<{ cookie: string; loggedIn: boolean }> {
  const jar = parseCookie(userCookie);
  if (jar.has('ttwid')) {
    const nonce = jar.get('__ac_nonce');
    if (nonce && !jar.has('__ac_signature')) {
      jar.set('__ac_signature', acSignature('www.douyin.com', nonce, UA, Math.floor(Date.now() / 1000)));
    }
    return { cookie: cookieString(jar), loggedIn: hasLogin(jar) };
  }

  const store = (headers: Headers) => {
    for (const c of headers.getSetCookie?.() ?? []) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      if (i > 0) jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
    }
  };
  for (const url of ['https://www.douyin.com/', 'https://live.douyin.com/']) {
    const res = await fetch(url, { headers: { ...HEADERS, ...(jar.size ? { Cookie: cookieString(jar) } : {}) }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    store(res.headers);
    await res.text();
  }
  const nonce = jar.get('__ac_nonce');
  if (nonce && jar.get('ttwid')) {
    jar.set('__ac_signature', acSignature('www.douyin.com', nonce, UA, Math.floor(Date.now() / 1000)));
  }
  // 只贴了登录字段、没贴 ttwid 时也走这条路：登录态还在，别误报成匿名
  return { cookie: cookieString(jar), loggedIn: hasLogin(jar) };
}

/** web_rid → 内部 room_id + 主播/标题；顺带判断开播状态 */
export async function getRoom(webRid: number | string, cookie: string): Promise<DouyinRoom> {
  const rid = String(webRid);
  const res = await fetch(`https://live.douyin.com/${rid}`, {
    headers: { ...HEADERS, Cookie: cookie, Referer: `https://live.douyin.com/${rid}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const html = (await res.text()).replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  // 页面里的 roomId 有两种转义写法，都试
  const roomId = html.match(/roomId\\?"\s*[:=]\s*\\?"(\d+)\\?"/)?.[1] ?? html.match(/"roomId"\s*:\s*"?(\d+)"?/)?.[1];
  if (!roomId) throw new Error('抖音没给这个直播间的 room_id（房间号不对，或者直播间不存在）');

  const title = html.match(/"title"\s*:\s*"([^"]{1,80})"/)?.[1] ?? html.match(/title\\?"\s*:\s*\\?"([^"\\]{1,80})/)?.[1];
  // 页面里 $undefined 是前端占位符，不是真昵称
  const rawName = html.match(/nickname\\?"\s*:\s*\\?"([^"\\]{1,40})/)?.[1] ?? html.match(/"nickname"\s*:\s*"([^"]{1,40})"/)?.[1];
  const anchorName = rawName && !rawName.startsWith('$') ? rawName : undefined;
  // 页面里的 room_status 语义在几个实现之间不一致（0 和 2 都被当成过直播中），
  // 所以不拿它判断开播：连接后是否收到消息才是准的，见 douyinSource。
  return {
    roomId,
    ...(title ? { title: title.replace(/…*展开$/, '').trim() } : {}),
    ...(anchorName ? { anchorName } : {}),
  };
}

/**
 * 弹幕连接的签名入参：抖音对这个串取 md5，再交给 webmssdk 算 X-Bogus。
 * 注意 user_unique_id 填的是 room_id（真实网页端就是这样），ac 留空。
 */
export function signParams(roomId: string): string {
  return 'live_id=1,aid=6383,version_code=180800,webcast_sdk_version=1.0.14-beta.0,'
    + `room_id=${roomId},sub_room_id=,sub_channel_id=,did_rule=3,user_unique_id=${roomId},`
    + 'device_platform=web,device_type=,ac=,identity=audience';
}

/** 弹幕连接的 wss 地址（signature 由 douyinSign 单独算好传进来） */
export function pushUrl(roomId: string, signature: string, now = Date.now()): string {
  const cursor = `r-${roomId}_d-1_u-1_fh-${roomId}_t-${now}`;
  const internalExt = `internal_src:dim|wss_push_room_id:${roomId}|wss_push_did:${roomId}`
    + `|first_req_ms:${now}|fetch_time:${now}|seq:1|wss_info:0-${now}-0-0|wrds_v:${roomId}`;
  const params = [
    'app_name=douyin_web', 'version_code=180800', 'webcast_sdk_version=1.0.14-beta.0', 'update_version_code=1.0.14-beta.0',
    'compress=gzip', 'device_platform=web', 'cookie_enabled=true', 'screen_width=1536', 'screen_height=864',
    'browser_language=zh-CN', 'browser_platform=Win32', 'browser_name=Mozilla',
    `browser_version=${encodeURIComponent('5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36')}`,
    'browser_online=true', 'tz_name=Asia/Shanghai',
    `cursor=${encodeURIComponent(cursor)}`, `internal_ext=${encodeURIComponent(internalExt)}`,
    'host=https://live.douyin.com', 'aid=6383', 'live_id=1', 'did_rule=3', 'endpoint=live_pc', 'support_wrds=1',
    `user_unique_id=${roomId}`, 'im_path=/webcast/im/fetch/', 'identity=audience', 'need_persist_msg_count=15',
    'insert_task_id=', 'live_reason=', `room_id=${roomId}`, 'heartbeatDuration=0',
  ].join('&');
  // 签名里会出现 + 和 /（如 Rp8z6ZmDtZZtR+rQ）：不编码的话 + 会被当成空格，连接就被拒
  return `wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/?${params}&signature=${encodeURIComponent(signature)}`;
}
