import { describe, expect, test } from "bun:test"
import { browserRandomId } from "./browserRandomId"

describe("browserRandomId", () => {
  test("uses randomUUID when the browser provides it", () => {
    const crypto = { randomUUID: () => "native-id", getRandomValues: () => { throw new Error("unused") } }

    expect(browserRandomId(crypto)).toBe("native-id")
  })

  test("falls back to getRandomValues in browsers without randomUUID", () => {
    const crypto = {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
        return bytes
      },
    }

    expect(browserRandomId(crypto)).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f")
  })

  test("returns undefined when no secure browser crypto source exists", () => {
    expect(browserRandomId(undefined)).toBeUndefined()
  })
})
