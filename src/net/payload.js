// Native Web API Compression for WebRTC SDP payloads
// Uses native browser & Node.js CompressionStream / DecompressionStream (deflate-raw)

function bytesToBase64(bytes) {
  let bin = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 8192) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, len)));
  }
  return btoa(bin);
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export async function compressToBase64(str) {
  if (str === null || str === undefined || str === '') return '';
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
}

export async function decompressFromBase64(base64) {
  if (!base64) return '';
  try {
    const bytes = base64ToBytes(base64);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  } catch {
    return '';
  }
}

/**
 * Packs an RTCSessionDescription ({ type, sdp }) into a compressed base64 token.
 */
export async function packSignal(desc) {
  if (!desc || !desc.sdp) return '';
  const payload = JSON.stringify({
    type: desc.type,
    sdp: desc.sdp,
  });
  const compressed = await compressToBase64(payload);
  return 'TANK:' + compressed;
}

/**
 * Unpacks a compressed base64 token back into an RTCSessionDescription object.
 */
export async function unpackSignal(token) {
  if (!token || typeof token !== 'string') return null;
  let str = token.trim();
  if (str.startsWith('TANK:')) {
    str = str.slice(5);
  }
  try {
    const decompressed = await decompressFromBase64(str);
    if (decompressed) {
      const parsed = JSON.parse(decompressed);
      if (parsed && (parsed.type === 'offer' || parsed.type === 'answer') && parsed.sdp) {
        return parsed;
      }
    }
  } catch {}

  // Fallback: If not compressed or raw JSON
  try {
    const parsed = JSON.parse(token);
    if (parsed && (parsed.type === 'offer' || parsed.type === 'answer') && parsed.sdp) {
      return parsed;
    }
  } catch {}

  return null;
}
