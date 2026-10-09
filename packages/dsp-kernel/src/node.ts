import { DspKernel, kernelWasmBytes } from "./index.ts";

let module: WebAssembly.Module | undefined;

/**
 * A kernel instance for Node; the module is compiled once per process. Browsers' main threads
 * refuse synchronous compiles this large, so the studio compiles it in its AudioWorklet instead.
 */
export function createNodeDspKernel(): DspKernel {
  module ??= new WebAssembly.Module(kernelWasmBytes());
  return new DspKernel(module);
}
