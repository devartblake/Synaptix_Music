import { readFileSync } from "node:fs";

import { DspKernel } from "./index.ts";

let module: WebAssembly.Module | undefined;

/** A kernel instance for Node; the module is compiled once per process. */
export function createNodeDspKernel(): DspKernel {
  module ??= new WebAssembly.Module(readFileSync(new URL("../synaptix-dsp.wasm", import.meta.url)));
  return new DspKernel(module);
}
