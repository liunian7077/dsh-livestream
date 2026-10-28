import { afterEach, describe, expect, it, vi } from 'vitest';
import { Songbook } from '../src/body/songbook';
import { resolveSong, searchSongs, type SongMatch } from '../src/body/netease';
import { isRestrictedSong, isRestrictedSongName, isRestrictedSongRequest, SONG_RESTRICTION_MESSAGE } from '../src/core/songPolicy';
import { HISTORICAL_RESTRICTED_SONGS } from '../src/core/restrictedSongs2015';
import { parseSongRequest } from '../src/core/songRequest';
import { topicText } from '../src/core/topicText';

const viewer = (id: string) => ({ id, name: id });
const query = (text: string) => parseSongRequest(`点歌 ${text}`)!;
const track = (id: string, name: string, aliases?: string[]): SongMatch => ({
  id, name, artists: ['测试歌手'], album: '测试专辑', durationMs: 180_000, score: 1,
  ...(aliases ? { aliases } : {}),
});

afterEach(() => vi.unstubAllGlobals());

describe('livestream song restrictions', () => {
  it.each([
    '国歌', '中华人民共和国国歌', '義勇軍進行曲（合唱版）', '义勇军进行曲 伴奏',
    '义 勇 军 进 行 曲', '义.勇-军_进/行\\曲', '义\u200b勇\u200d军\ufeff进行曲',
    '國　歌', 'March of the Volunteers', 'Ｍａｒｃｈ ｏｆ ｔｈｅ Ｖｏｌｕｎｔｅｅｒｓ',
    'Yì Yǒng Jūn Jìn Xíng Qǔ', 'National Anthem of the People’s Republic of China',
    '中国人民解放军进行曲', '中國人民解放軍軍歌（伴奏）', "People's Liberation Army March",
  ])('blocks %s before searching or resolving audio', async (text) => {
    const find = vi.fn();
    const resolve = vi.fn();
    const book = new Songbook({ find, resolve });
    expect(await book.request(query(text), viewer('a'))).toEqual({ kind: 'blocked' });
    expect(find).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(book.playing).toBeNull();
    expect(book.waiting).toEqual([]);
  });

  it('checks raw requests even when the parser truncates the artist', async () => {
    const find = vi.fn();
    const book = new Songbook({ find, resolve: vi.fn() });
    const request = query(`晴天 ${'某'.repeat(45)} 义勇军进行曲`);
    expect(request.artist).not.toContain('义勇军进行曲');
    expect(await book.request(request, viewer('a'))).toEqual({ kind: 'blocked' });
    expect(find).not.toHaveBeenCalled();
  });

  it.each(['晴天', '歌唱祖国', '我和我的祖国', '国际歌', 'National Anthem', '当兵的人', '军歌嘹亮', '运动员进行曲'])('does not ban unrelated title %s', (name) => {
    expect(isRestrictedSongName(name)).toBe(false);
  });

  it.each([
    track('1', '义勇军进行曲（纯音乐）'),
    track('2', '进行曲', ['中华人民共和国国歌']),
  ])('rejects restricted search results even under an innocent query', async (song) => {
    const resolve = vi.fn();
    const book = new Songbook({ find: async () => song, resolve });
    expect(await book.request(query('进行曲'), viewer('a'))).toEqual({ kind: 'blocked' });
    expect(resolve).not.toHaveBeenCalled();
    expect(book.playing).toBeNull();
    expect(book.waiting).toEqual([]);
  });

  it('keeps normal playback and queue progression working after a rejected request', async () => {
    const resolve = vi.fn(async (song) => `https://audio.example/${song.id}`);
    const book = new Songbook({
      find: async (q) => q.title === '别名' ? track('bad', '义勇军进行曲') : track(q.title, q.title),
      resolve,
    });
    expect((await book.request(query('晴天'), viewer('a'))).kind).toBe('loading');
    const first = book.playing!;
    expect(book.source(first.seq)).toBe('https://audio.example/晴天');
    book.report(first.seq, 'playing');
    expect(await book.request(query('别名'), viewer('b'))).toEqual({ kind: 'blocked' });
    expect(book.playing?.seq).toBe(first.seq);
    expect(book.playback?.status).toBe('playing');
    expect((await book.request(query('稻香'), viewer('b'))).kind).toBe('queued');
    await book.next();
    expect(book.playing?.song.name).toBe('稻香');
    expect(book.source(first.seq)).toBeNull();
    expect(resolve.mock.calls.map(([song]) => song.name)).toEqual(['晴天', '稻香']);
  });

  it('rechecks queued metadata and skips a newly restricted entry without resolving it', async () => {
    const resolve = vi.fn(async (song) => `https://audio.example/${song.id}`);
    const book = new Songbook({ find: async (q) => track(q.title, q.title), resolve });
    await book.request(query('第一首'), viewer('a'));
    await book.request(query('第二首'), viewer('b'));
    await book.request(query('第三首'), viewer('c'));
    // 模拟排队期间更新/恢复的元数据，必须在轮到播放时再次检查。
    book.waiting[0].song.aliases = ['義勇軍進行曲'];
    await book.next();
    expect(book.playing?.song.name).toBe('第三首');
    expect(book.waiting).toEqual([]);
    expect(resolve.mock.calls.map(([song]) => song.name)).toEqual(['第一首', '第三首']);
  });

  it('retains provider aliases so a renamed search result cannot evade the queue check', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200, result: { songs: [{ id: 123, name: '进行曲', alias: ['义勇军进行曲'], artists: [], album: { name: '曲集' } }] },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const results = await searchSongs('进行曲');
    expect(results[0].aliases).toEqual(['义勇军进行曲']);
    const resolve = vi.fn();
    const book = new Songbook({ find: async () => ({ ...results[0], score: 1 }), resolve });
    expect(await book.request(query('进行曲'), viewer('a'))).toEqual({ kind: 'blocked' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('also rejects direct audio resolution before making a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(resolveSong(track('123', '进行曲', ['义勇军进行曲'])))
      .rejects.toThrow(SONG_RESTRICTION_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives the host a refusal result without echoing the request or suggesting another playback route', () => {
    const text = topicText({
      id: 'blocked', kind: 'song', outcome: 'blocked', asked: '国歌 观众原话', by: '测试观众',
      priority: 60, heat: 'quiet', createdAt: 0,
    }, {});
    expect(text).toContain(SONG_RESTRICTION_MESSAGE.slice(0, -1));
    expect(text).not.toContain('观众原话');
    expect(text).not.toContain('国歌');
    expect(text).toContain('不要搜索其他音视频版本');
  });
});

describe('2015 historical work restrictions', () => {
  it.each(HISTORICAL_RESTRICTED_SONGS)('prevents audio resolution for official entry $number: $title', async (entry) => {
    const song = { ...track(String(entry.number), entry.title), artists: [...entry.artists] };
    const resolve = vi.fn();
    const book = new Songbook({ find: async () => song, resolve });
    expect(await book.request(query(`${entry.title} ${entry.artists.join('/')}`.trim()), viewer('a')))
      .toEqual({ kind: 'blocked' });
    expect(resolve).not.toHaveBeenCalled();
    expect(book.playing).toBeNull();
    expect(book.waiting).toEqual([]);
  });

  it.each([
    ['摇头玩', '许嵩'], ['我爱台妹', 'MC Hotdog'], ['我愛台妹', '熱狗'],
    ['咬春', '赵雷'], ['大学生自习室', '郝雨'], ['吹喇叭', '罗百吉'],
    ['搖頭玩（Live）', '許嵩'], ['我 愛 台 妹（DJ版）', '張震嶽'],
    ['ＴＲＯＵＢＬＥ（Remix）', '张震岳'], ['爽（现场版）', '黄立行'],
    ['骚\u200b麦', '小莫'], ['今晚叼鸠你', '黄秋生'], ['今晚叼胶你', '大懒堂'],
    ['摇头玩（cover 许嵩）', '翻唱歌手'], ['摇头玩（原唱：许嵩）', '翻唱歌手'],
  ])('recognizes %s by %s including known variants', (name, artist) => {
    expect(isRestrictedSong({ name, artists: [artist] })).toBe(true);
  });

  it.each([
    ['背叛', '曹格'], ['十八岁', '另一位歌手'], ['爽快', '黄立行'],
    ['TROUBLE MAKER', '张震岳'], ['背叛者', 'MC天佑'], ['晴天', '张震岳'],
    ['有何不可', '许嵩'], ['成都', '赵雷'], ['爽', '另一位歌手'],
  ])('does not ban another work or performer: %s by %s', (name, artist) => {
    expect(isRestrictedSong({ name, artists: [artist] })).toBe(false);
    expect(isRestrictedSongRequest(query(`${name}--${artist}`))).toBe(false);
  });

  it('waits for provider metadata when the viewer omits an ambiguous performer', async () => {
    const find = vi.fn(async () => ({ ...track('123', '背叛'), artists: ['曹格'] }));
    const resolve = vi.fn(async () => 'https://audio.example/123');
    const book = new Songbook({ find, resolve });
    expect(isRestrictedSongRequest(query('背叛'))).toBe(false);
    expect((await book.request(query('背叛'), viewer('a'))).kind).toBe('loading');
    expect(find).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
  });

  it.each([{ artists: [] }, { artists: [''] }, { artists: ['网络歌手'] }, { artists: ['佚名'] }])('rejects a listed title when provider attribution cannot be checked: $artists', ({ artists }) => {
    expect(isRestrictedSong({ name: '背叛', artists })).toBe(true);
  });

  it('rejects uncredited official entries regardless of the uploaded performer', () => {
    expect(isRestrictedSong({ name: '泡妞秘笈', artists: ['上传者'] })).toBe(true);
    expect(isRestrictedSongRequest(query('泡妞秘笈'))).toBe(true);
  });

  it('blocks an explicitly requested work before a search can substitute a cover', async () => {
    const find = vi.fn(async () => ({ ...track('123', '摇头玩'), artists: ['翻唱歌手'] }));
    const book = new Songbook({ find, resolve: vi.fn() });
    expect(await book.request(query('摇头玩--许嵩'), viewer('a'))).toEqual({ kind: 'blocked' });
    expect(find).not.toHaveBeenCalled();
  });

  it('checks the complete raw title when spaces split an English title into the artist field', () => {
    expect(isRestrictedSongRequest(query('T R O U B L E 张震岳'))).toBe(true);
  });

  it('checks provider aliases together with actual artists even under an innocent query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      code: 200, result: { songs: [{ id: 123, name: '重新上传', alias: ['摇头玩'], artists: [{ name: '许嵩' }] }] },
    })));
    vi.stubGlobal('fetch', fetchMock);
    const results = await searchSongs('重新上传');
    const resolve = vi.fn();
    const book = new Songbook({ find: async () => ({ ...results[0], score: 1 }), resolve });
    expect(await book.request(query('重新上传'), viewer('a'))).toEqual({ kind: 'blocked' });
    expect(resolve).not.toHaveBeenCalled();
    await expect(resolveSong(results[0])).rejects.toThrow(SONG_RESTRICTION_MESSAGE);
    // Only the search ran; no audio request was sent.
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rechecks title and artist when a queued entry becomes restricted', async () => {
    const resolve = vi.fn(async (song) => `https://audio.example/${song.id}`);
    const book = new Songbook({ find: async (q) => track(q.title, q.title), resolve });
    await book.request(query('第一首'), viewer('a'));
    await book.request(query('第二首'), viewer('b'));
    await book.request(query('第三首'), viewer('c'));
    book.waiting[0].song.name = '摇头玩';
    book.waiting[0].song.artists = ['许嵩'];
    await book.next();
    expect(book.playing?.song.name).toBe('第三首');
    expect(book.waiting).toEqual([]);
    expect(resolve.mock.calls.map(([song]) => song.name)).toEqual(['第一首', '第三首']);
  });
});

describe('owner requested song restrictions', () => {
  it.each([
    '点歌八连杀', '点歌 八连杀 秋桔', '点歌 八連殺--其他翻唱歌手',
    '点歌 八 连 杀', '點歌 八\u200b連\u200d殺', '点歌 ８连杀',
    '点歌 八连杀（伴奏版）', '点歌 八连杀（DJ Remix）',
    '点歌 Ba Lian Sha', '点歌 Bā Lián Shā',
  ])('rejects %s before searching, queuing or resolving audio', async (command) => {
    const find = vi.fn();
    const resolve = vi.fn();
    const book = new Songbook({ find, resolve });
    expect(await book.request(parseSongRequest(command)!, viewer('a'))).toEqual({ kind: 'blocked' });
    expect(find).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(book.playing).toBeNull();
    expect(book.waiting).toEqual([]);
  });

  it.each([
    { ...track('123', '八连杀'), artists: ['秋桔'] },
    { ...track('124', '八连杀（翻唱）'), artists: ['其他歌手'] },
    { ...track('125', '八連殺（纯音乐）'), artists: [] },
    { ...track('126', '舞曲精选', ['八连杀']), artists: ['上传者'] },
  ])('rejects a matching result or alias regardless of artist and blocks direct resolution: $name', async (song) => {
    const resolve = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const book = new Songbook({ find: async () => song, resolve });
    expect(await book.request(query('舞曲'), viewer('a'))).toEqual({ kind: 'blocked' });
    expect(resolve).not.toHaveBeenCalled();
    expect(book.waiting).toEqual([]);
    await expect(resolveSong(song)).rejects.toThrow(SONG_RESTRICTION_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips a queued entry whose metadata now names the restricted song', async () => {
    const resolve = vi.fn(async (song) => `https://audio.example/${song.id}`);
    const book = new Songbook({ find: async (q) => track(q.title, q.title), resolve });
    await book.request(query('第一首'), viewer('a'));
    await book.request(query('第二首'), viewer('b'));
    await book.request(query('第三首'), viewer('c'));
    book.waiting[0].song.aliases = ['八连杀（DJ版）'];
    await book.next();
    expect(book.playing?.song.name).toBe('第三首');
    expect(resolve.mock.calls.map(([song]) => song.name)).toEqual(['第一首', '第三首']);
  });

  it('returns the same generic refusal without repeating the viewer request', () => {
    const reply = topicText({
      id: 'blocked-local', kind: 'song', outcome: 'blocked', asked: '八连杀 秋桔', by: '观众',
      priority: 60, heat: 'quiet', createdAt: 0,
    }, {});
    expect(reply).toContain(SONG_RESTRICTION_MESSAGE.slice(0, -1));
    expect(reply).not.toContain('八连杀');
    expect(reply).not.toContain('秋桔');
  });

  it('keeps unrelated songs playable for the same performer', () => {
    expect(isRestrictedSong({ name: '晴天', artists: ['秋桔'] })).toBe(false);
    expect(isRestrictedSongRequest(query('八月'))).toBe(false);
  });
});
