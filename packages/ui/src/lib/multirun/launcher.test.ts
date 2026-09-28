import { expect, test } from "bun:test"
import { createRunLauncherId } from "./launcher"

test("creates a launcher id without randomUUID", () => {
  const crypto = {
    getRandomValues: (bytes: Uint8Array) => {
      bytes.fill(1)
      return bytes
    },
  }

  expect(createRunLauncherId(crypto)).toBe("01010101-0101-4101-8101-010101010101")
})
