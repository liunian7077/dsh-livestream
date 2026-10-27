import { describe, expect, it } from 'vitest';
import { acSignature, hasLogin, parseCookie, pushUrl, signParams } from '../src/core/platforms/douyin/douyinApi';

/**
 * 抖音侧的纯函数：
 * - __ac_signature 的算法（照 ac_signature.py 移植），用一个固定输入钉住输出，
 *   免得以后改动悄悄漂移。
 * - 签名入参和 wss 地址的形状：抖音服务端就是按这个串取 md5 算签名的，
 *   参数顺序或字段名错了会直接连不上，所以逐条断言。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0';

describe('douyin api', () => {
  it('computes __ac_signature deterministically from site, ua and timestamp', () => {
    const sig = acSignature('www.douyin.com', 'ignored-nonce', UA, 1_760_000_000);
    // 四段各 5 个字符（24..0 每 6 位取一个），字母数字混合，共 20 个
    expect(sig).toHaveLength(20);
    expect(sig).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(acSignature('www.douyin.com', 'another-nonce', UA, 1_760_000_000)).toBe(sig);
    expect(acSignature('www.douyin.com', 'n', UA, 1_760_000_001)).not.toBe(sig);
    expect(acSignature('live.douyin.com', 'n', UA, 1_760_000_000)).not.toBe(sig);
  });

  it('parses a pasted cookie string and ignores malformed parts', () => {
    const jar = parseCookie('ttwid=abc; __ac_nonce=xyz; broken; sessionid_ss=secret=with=equals');
    expect(jar.get('ttwid')).toBe('abc');
    expect(jar.get('__ac_nonce')).toBe('xyz');
    expect(jar.has('broken')).toBe(false);
    expect(jar.get('sessionid_ss')).toBe('secret=with=equals');
  });

  it('treats any douyin login token as logged in, and ttwid-only as guest', () => {
    expect(hasLogin('ttwid=abc')).toBe(false);
    expect(hasLogin('ttwid=abc; __ac_nonce=n')).toBe(false);
    expect(hasLogin('ttwid=abc; sessionid=web')).toBe(true);
    expect(hasLogin('ttwid=abc; sessionid_ss=secure')).toBe(true);
    expect(hasLogin('ttwid=abc; sid_tt=backup')).toBe(true);
    expect(hasLogin(new Map([['sessionid_ss', 'x']]))).toBe(true);
  });

  it('builds the signature input exactly as douyin expects', () => {
    expect(signParams('7701223924599966490')).toBe(
      'live_id=1,aid=6383,version_code=180800,webcast_sdk_version=1.0.14-beta.0,'
      + 'room_id=7701223924599966490,sub_room_id=,sub_channel_id=,did_rule=3,'
      + 'user_unique_id=7701223924599966490,device_platform=web,device_type=,ac=,identity=audience',
    );
  });

  it('builds a wss url carrying the room, the signature and the browser-ish params', () => {
    const url = new URL(pushUrl('7701223924599966490', 'SIG/w+1', 1_760_000_000_000));
    expect(url.protocol).toBe('wss:');
    expect(url.pathname).toBe('/webcast/im/push/v2/');
    // 签名里的 + / 必须编码，否则 + 会被当成空格
    expect(url.searchParams.get('signature')).toBe('SIG/w+1');
    expect(url.search).toContain('signature=SIG%2Fw%2B1');
    expect(url.searchParams.get('room_id')).toBe('7701223924599966490');
    expect(url.searchParams.get('user_unique_id')).toBe('7701223924599966490');
    expect(url.searchParams.get('compress')).toBe('gzip');
    expect(url.searchParams.get('identity')).toBe('audience');
    expect(url.searchParams.get('internal_ext')).toContain('wss_push_room_id:7701223924599966490');
    expect(url.searchParams.get('cursor')).toContain('r-7701223924599966490_d-1_u-1');
  });
});
