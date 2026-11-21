/**
 * MediaPipe's wasm runtime prints its start-up notes ("INFO: Created TensorFlow Lite XNNPACK
 * delegate for CPU.") through console.error, so Next's dev overlay counted an "Issue" every time
 * the camera started. The runtime binds console.error when a model is created, so creating one
 * through this hands it a console.error that drops just those "INFO: " notes. Everything else,
 * MediaPipe's real errors included, still goes through, and console.error itself is put back.
 */
export async function withQuietInfo<T>(create: () => Promise<T>): Promise<T> {
  const error = console.error;
  const quiet = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("INFO: ")) return;
    error.apply(console, args);
  };
  console.error = quiet;
  try {
    return await create();
  } finally {
    if (console.error === quiet) console.error = error;
  }
}
