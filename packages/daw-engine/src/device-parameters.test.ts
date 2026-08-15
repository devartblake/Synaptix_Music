import assert from "node:assert/strict";
import test from "node:test";

import type { Device } from "@synaptix/project-model";

import {
  clampDeviceParameterValue,
  deviceParameterDefinition,
  FILTER_FREQUENCY_PARAMETER,
  resolveDeviceParameterValue
} from "./device-parameters.ts";

function device(parameters: Device["parameters"]): Device {
  return { id: "device-1", deviceType: "synaptix-lead-synth", deviceVersion: "1.0.0", enabled: true, parameters };
}

test("clamping keeps values within the canonical parameter range", () => {
  assert.equal(clampDeviceParameterValue(FILTER_FREQUENCY_PARAMETER, 40), 80);
  assert.equal(clampDeviceParameterValue(FILTER_FREQUENCY_PARAMETER, 20000), 16000);
  assert.equal(clampDeviceParameterValue(FILTER_FREQUENCY_PARAMETER, 3000), 3000);
});

test("clamping is a no-op for unknown parameter identifiers", () => {
  assert.equal(clampDeviceParameterValue("unknown-parameter", 999999), 999999);
});

test("resolving a device parameter prefers the stored override, clamped to range", () => {
  const value = resolveDeviceParameterValue(device([{ id: FILTER_FREQUENCY_PARAMETER, value: 500000 }]), FILTER_FREQUENCY_PARAMETER, 7000);
  assert.equal(value, 16000);
});

test("resolving a device parameter falls back to the default when unset or non-finite", () => {
  assert.equal(resolveDeviceParameterValue(device([]), FILTER_FREQUENCY_PARAMETER, 7000), 7000);
  assert.equal(resolveDeviceParameterValue(undefined, FILTER_FREQUENCY_PARAMETER, 7000), 7000);
  assert.equal(
    resolveDeviceParameterValue(device([{ id: FILTER_FREQUENCY_PARAMETER, value: Number.NaN }]), FILTER_FREQUENCY_PARAMETER, 7000),
    7000
  );
});

test("every canonical definition exposes a finite, ordered range", () => {
  const definition = deviceParameterDefinition(FILTER_FREQUENCY_PARAMETER);
  assert.ok(definition);
  assert.ok(definition.minimum < definition.maximum);
});
