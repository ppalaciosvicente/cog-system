if (typeof globalThis.structuredClone === "undefined") {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value));
}

if (typeof globalThis.AbortSignal === "function") {
  const signalProto = globalThis.AbortSignal.prototype;
  if (typeof signalProto.throwIfAborted !== "function") {
    const AbortError =
      typeof globalThis.DOMException === "function"
        ? class AbortError extends globalThis.DOMException {}
        : class AbortError extends Error {
            constructor(message) {
              super(message);
              this.name = "AbortError";
            }
          };

    signalProto.throwIfAborted = function () {
      if (this.aborted) {
        throw new AbortError("Aborted");
      }
    };
  }
}
