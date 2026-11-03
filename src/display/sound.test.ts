import { describe, expect, it } from "vitest";
import type { JsonValue } from "../engine/types";
import { bytesToB64 } from "../spectrum/screen";
import { decodeSound } from "./sound";

const dict = (o: Record<string, JsonValue>): JsonValue => ({ $dict: Object.entries(o) });
const frame = (fields: Record<string, unknown>) => (k: string) => fields[k];

describe("decodeSound", () => {
  it("is nothing for a frame without sound", () => {
    expect(decodeSound(frame({ kind: "indexed" }))).toEqual({ tones: [], pcm: null });
  });

  it("reads tones, square at 0.3 unless said, and keeps them within reason", () => {
    const s = decodeSound(
      frame({
        tones: [
          dict({ hz: 440, ms: 100 }),
          dict({ hz: 80, ms: 400, wave: "noise", vol: 2, to: 40 }),
          dict({ hz: 5, ms: 99999, wave: "kazoo" }),
          dict({ hz: 440 }), // no length: not a note
          "beep",
        ],
      }),
    );
    expect(s.tones).toEqual([
      { hz: 440, ms: 100, wave: "square", vol: 0.3, to: 440 },
      { hz: 80, ms: 400, wave: "noise", vol: 1, to: 40 },
      { hz: 20, ms: 5000, wave: "square", vol: 0.3, to: 20 },
    ]);
  });

  it("reads 8-bit samples, 128 silence, as −1…1", () => {
    const s = decodeSound(frame({ audio: dict({ rate: 22050, pcm: bytesToB64(Uint8Array.from([128, 255, 0])) }) }));
    expect(s.pcm?.rate).toBe(22050);
    expect([...s.pcm!.samples]).toEqual([0, 127 / 128, -1]);
  });

  it("refuses a rate no one can play, and bytes that aren't base64", () => {
    expect(decodeSound(frame({ audio: dict({ rate: 100, pcm: "gA==" }) })).pcm).toBeNull();
    expect(decodeSound(frame({ audio: dict({ rate: 8000, pcm: "%%%" }) })).pcm).toBeNull();
  });
});
