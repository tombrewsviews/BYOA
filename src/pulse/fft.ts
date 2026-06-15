// src/pulse/fft.ts
// Iterative radix-2 Cooley–Tukey FFT. Input length must be a power of 2.
// Real-input convenience: returns the magnitude spectrum (length N/2).
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe; im[b] = im[a] - tIm;
        re[a] += tRe; im[a] += tIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe; curRe = nRe;
      }
    }
  }
}

export function fftMagnitudes(input: Float32Array): Float32Array {
  const n = input.length;
  if ((n & (n - 1)) !== 0) throw new Error("fft: length must be a power of 2");
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = input[i];
  fftInPlace(re, im);
  const half = n >> 1;
  const out = new Float32Array(half);
  for (let i = 0; i < half; i++) out[i] = Math.hypot(re[i], im[i]) / n;
  return out;
}
