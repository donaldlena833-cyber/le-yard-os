import { defineConfig } from "vitest/config";
import base from "./vitest.config.mts";
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["tests/provider/sms-ai-provider.test.ts"],
    testTimeout: 20000,
    fileParallelism: false,
  },
});
