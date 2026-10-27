/** 正式构建 / pnpm dev：三块代码一起建（lib/ 由 package.json 的 build 脚本先清） */
import { defineConfig } from 'tsdown';
import { client, host, stage } from './build/config.ts';

export default defineConfig([host(), client(), stage()]);
