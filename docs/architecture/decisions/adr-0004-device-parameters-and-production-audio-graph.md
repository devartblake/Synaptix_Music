# ADR-0004: Canonical Device Parameters and Explicit Production Audio Graph

**Status:** Accepted  
**Revision date:** 2026-08-05

## Context

Track-name heuristics and direct Tone.js mutation cannot provide stable project portability or equivalent browser and worker rendering. Device and effect state must be represented independently of the runtime implementation.

## Decision

Represent instruments and effects as versioned canonical devices with stable numeric parameter identifiers. Route browser preview audio through an explicit graph of instrument, filter, track channel, drum/music bus, shared effect return, master compression, and peak/RMS meters.

Tone.js remains behind engine interfaces. Production workers must map the same canonical device and parameter semantics into their offline runtime.

## Consequences

- Device behavior is project data rather than hidden UI state.
- Browser and worker engines can target equivalent semantics.
- Parameter ranges and migration rules must be documented and tested.
- Runtime nodes must be rebuilt or updated deterministically after project changes.
- Third-party plugin hosting is not implied by this decision.

## Rejected Alternatives

- Track-name-only instrument selection
- React controls that mutate Tone.js nodes without canonical commands
- A single undifferentiated master destination without buses or meter evidence
