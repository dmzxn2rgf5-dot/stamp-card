import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../src/types";

declare global {
  namespace Cloudflare {
    interface Env extends Omit<import("../src/types").Env, never> {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export type { Env };
