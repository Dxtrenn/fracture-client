// Minimal reader for Minecraft's NBT format, enough to read servers.dat.
// servers.dat is uncompressed big-endian NBT: a root compound with a "servers" list.

function readNbt(buf) {
  let pos = 0;
  const u8 = () => buf.readUInt8(pos++);
  const i16 = () => { const v = buf.readInt16BE(pos); pos += 2; return v; };
  const u16 = () => { const v = buf.readUInt16BE(pos); pos += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(pos); pos += 4; return v; };
  const str = () => { const n = u16(); const s = buf.toString("utf8", pos, pos + n); pos += n; return s; };

  function payload(type) {
    switch (type) {
      case 1: return buf.readInt8(pos++);
      case 2: return i16();
      case 3: return i32();
      case 4: { const v = buf.readBigInt64BE(pos); pos += 8; return v; }
      case 5: { const v = buf.readFloatBE(pos); pos += 4; return v; }
      case 6: { const v = buf.readDoubleBE(pos); pos += 8; return v; }
      case 7: { const n = i32(); const v = buf.subarray(pos, pos + n); pos += n; return v; }
      case 8: return str();
      case 9: {
        const itemType = u8();
        const n = i32();
        const out = [];
        for (let i = 0; i < n; i++) out.push(payload(itemType));
        return out;
      }
      case 10: {
        const out = {};
        for (;;) {
          const t = u8();
          if (t === 0) return out;
          const name = str();
          out[name] = payload(t);
        }
      }
      case 11: { const n = i32(); const out = []; for (let i = 0; i < n; i++) out.push(i32()); return out; }
      case 12: { const n = i32(); pos += n * 8; return []; }
      default: throw new Error(`Unknown NBT tag ${type}`);
    }
  }

  const rootType = u8();
  if (rootType !== 10) throw new Error("Not an NBT compound");
  str(); // root name
  return payload(10);
}

/** Returns [{ name, ip, icon }] from a servers.dat buffer. */
function readServersDat(buf) {
  const root = readNbt(buf);
  return (root.servers || [])
    .filter((s) => s && typeof s.ip === "string" && s.ip.trim())
    .map((s) => ({ name: String(s.name || s.ip).slice(0, 40), ip: s.ip.trim(), icon: typeof s.icon === "string" ? s.icon : null }));
}

/** Builds a servers.dat buffer from [{ name, ip, icon }], the same layout Minecraft writes. */
function writeServersDat(list) {
  const parts = [];
  const u8 = (v) => parts.push(Buffer.from([v]));
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); parts.push(b); };
  const str = (s) => { const d = Buffer.from(String(s), "utf8"); const b = Buffer.alloc(2); b.writeUInt16BE(d.length); parts.push(b, d); };
  const strTag = (name, value) => { u8(8); str(name); str(value); };
  u8(10); str(""); // root compound
  u8(9); str("servers"); u8(10); i32(list.length);
  for (const s of list) {
    strTag("name", s.name || s.ip);
    strTag("ip", s.ip);
    if (s.icon) strTag("icon", s.icon);
    u8(0); // end of this server
  }
  u8(0); // end of root
  return Buffer.concat(parts);
}

module.exports = { readNbt, readServersDat, writeServersDat };
