import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';
import base from './vitest.config.mts';
export default defineConfig({
  ...base,
  resolve:{...base.resolve,alias:{...(base.resolve?.alias ?? {}),'@':fileURLToPath(new URL('./src',import.meta.url))}},
  test:{...base.test,include:['tests/local-readiness/**/*.test.mjs'],testTimeout:120000,hookTimeout:30000,fileParallelism:false},
});
