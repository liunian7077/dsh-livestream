import { describe, expect, it } from 'vitest';
import { clipBox, clipVideoStyle } from '../src/stage/layout';

describe('clip framing', () => {
  it('uses the whole picture when the pack declares no frame', () => {
    expect(clipBox({ size: [496, 864] })).toEqual([496, 864]);
    expect(clipVideoStyle([496, 864], undefined)).toBeUndefined();
  });

  it('lays the framed part of the picture over the whole character box', () => {
    const size: [number, number] = [640, 360];
    const frame: [number, number, number, number] = [150, 10, 370, 345];
    expect(clipBox({ size, frame })).toEqual([370, 345]);
    // 画面放大到 640/370 倍，再往左上挪，让取景框对齐挂件
    expect(clipVideoStyle(size, frame)).toEqual({
      left: `${(-150 / 370) * 100}%`,
      top: `${(-10 / 345) * 100}%`,
      width: `${(640 / 370) * 100}%`,
      height: `${(360 / 345) * 100}%`,
    });
  });
});
