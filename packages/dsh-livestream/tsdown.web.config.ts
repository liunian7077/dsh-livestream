/** 只调页面（pnpm dev:web）：只建控制台和舞台页 */
import { defineConfig } from 'tsdown';
import { client, stage } from './build/config.ts';

export default defineConfig([client(), stage()]);
