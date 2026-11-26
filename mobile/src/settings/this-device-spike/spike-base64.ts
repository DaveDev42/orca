const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LOOKUP = new Uint8Array(128).fill(255)
for (let index = 0; index < ALPHABET.length; index += 1) {
  LOOKUP[ALPHABET.charCodeAt(index)] = index
}

// Decodes padded or unpadded standard base64. Done by hand so the JS-thread cost in "via JS" mode is real work on bytes, not a bridge pass-through.
export function decodeBase64(text: string): Uint8Array {
  let length = text.length
  while (length > 0 && text.charCodeAt(length - 1) === 61) {
    length -= 1
  }
  const out = new Uint8Array(Math.floor((length * 3) / 4))
  let buffer = 0
  let bits = 0
  let position = 0
  for (let index = 0; index < length; index += 1) {
    const value = LOOKUP[text.charCodeAt(index) & 127]
    if (value === 255) {
      continue
    }
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[position] = (buffer >> bits) & 255
      position += 1
      buffer &= (1 << bits) - 1
    }
  }
  return out.subarray(0, position)
}
