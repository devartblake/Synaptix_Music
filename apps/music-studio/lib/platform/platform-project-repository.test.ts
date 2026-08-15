import assert from "node:assert/strict";
import test from "node:test";

import { extractErrorMessage } from "./platform-project-repository.ts";

test("extracts the message field from a JSON error envelope", () => {
  const body = JSON.stringify({
    code: "platform_unavailable",
    message: "SYNAPTIX_PLATFORM_API_URL is not configured.",
    correlationId: "abc",
    retryable: true
  });
  assert.equal(extractErrorMessage(body, 502), "SYNAPTIX_PLATFORM_API_URL is not configured.");
});

test("falls back to the raw body when it is not a JSON error envelope", () => {
  assert.equal(extractErrorMessage("Bad Gateway", 502), "Bad Gateway");
});

test("falls back to a generic status message when the body is empty", () => {
  assert.equal(extractErrorMessage("", 502), "Platform project request failed with 502.");
});

test("falls back to the raw body when the JSON has no usable message field", () => {
  const body = JSON.stringify({ code: "unknown_error" });
  assert.equal(extractErrorMessage(body, 500), body);
});
