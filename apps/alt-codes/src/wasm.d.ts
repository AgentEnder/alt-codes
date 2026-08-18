/**
 * A `.wasm` import inside a Cloudflare Worker resolves to an already-compiled
 * `WebAssembly.Module` — the runtime instantiates it at deploy time, because a Worker has no
 * way to fetch and compile one per request. Vite's client types describe `?init` and `?url`
 * imports but not this form, so it is declared here.
 *
 * Only `+server.ts` should use it; see the comment there.
 */
declare module '*.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
