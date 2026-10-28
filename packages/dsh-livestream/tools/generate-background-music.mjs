/**
 * 可复现的本地纯音乐素材：自行编排的柔和合成电钢琴与和弦，无人声、无外部采样。
 * node tools/generate-background-music.mjs
 * 只在制作素材时运行；直播时播放已生成的 WAV，不实时合成。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rate = 24000;
const beat = 60 / 80;
const seconds = 64 * beat;
const samples = new Float64Array(Math.round(rate * seconds));
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function note(midi, at, duration, gain, pad = false) {
  const frequency = hz(midi);
  const length = Math.round(duration * rate);
  const start = Math.round(at * rate);
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const release = Math.min(1, (duration - t) / (pad ? 0.8 : 0.35));
    const attack = Math.min(1, t / (pad ? 0.4 : 0.012));
    const envelope = attack * release * (pad ? 0.65 : Math.exp(-t / 0.85));
    const phase = 2 * Math.PI * frequency * t;
    const wave = Math.sin(phase) + (pad ? 0.06 : 0.22) * Math.sin(phase * 2) * Math.exp(-t * 2)
      + (pad ? 0 : 0.06) * Math.sin(phase * 3) * Math.exp(-t * 4);
    samples[(start + i) % samples.length] += gain * envelope * wave;
    // 两个很轻的延迟声部，让音色柔和；尾音环绕接回开头，保持可循环。
    if (!pad) {
      samples[(start + i + Math.round(rate * beat * 0.75)) % samples.length] += gain * envelope * wave * 0.16;
      samples[(start + i + Math.round(rate * beat * 1.5)) % samples.length] += gain * envelope * wave * 0.07;
    }
  }
}

const chords = [[48,55,59,64], [45,52,55,60], [53,57,60,64], [43,50,57,62],
  [48,55,59,62], [45,52,57,60], [53,60,64,67], [43,50,55,62]];
const melodies = [[76,74,72], [69,72,76], [76,79,76], [74,71,69],
  [72,76,74], [72,69,67], [69,72,76], [74,71,67]];
for (let bar = 0; bar < chords.length; bar++) {
  const chord = chords[bar];
  const start = bar * 8 * beat;
  for (const pitch of chord) note(pitch, start, 8 * beat + 0.7, 0.025, true);
  for (let step = 0; step < 8; step++) note(chord[[0,2,1,3,0,1,2,3][step]] + 12, start + step * beat, 2.7, 0.12);
  melodies[bar].forEach((pitch, i) => note(pitch, start + [1.5,4,6.5][i] * beat, 2.5, 0.095));
}
let peak = 0;
for (const value of samples) peak = Math.max(peak, Math.abs(value));
const scale = 0.7 / peak;
const wav = Buffer.alloc(44 + samples.length * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(samples[i] * scale * 32767), 44 + i * 2);
const dir = new URL('../assets/music/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('quiet-room.wav', dir), wav);
console.log(`Generated ${seconds}s instrumental loop: ${fileURLToPath(new URL('quiet-room.wav', dir))}`);
