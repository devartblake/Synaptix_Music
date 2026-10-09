//! The instrument voice: oscillator -> one-pole low-pass -> ADSR -> velocity.
//!
//! One implementation for the offline renderer and (next) the studio preview, so exports and
//! preview make the same samples. Everything is plain IEEE-754 `f64` arithmetic in a fixed order
//! (no fused multiply-add, no platform `sin`), so a render is bit-identical on every machine and
//! matches the TypeScript reference in `packages/dsp-kernel/src/kernel.test.ts`.

use core::f64::consts::FRAC_PI_2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Oscillator {
    Sine,
    /// Band-limited (PolyBLEP) square.
    Square,
    /// Band-limited (PolyBLEP) sawtooth.
    Sawtooth,
    Triangle,
}

impl Oscillator {
    /// Codes shared with the TypeScript side.
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Sine),
            1 => Some(Self::Square),
            2 => Some(Self::Sawtooth),
            3 => Some(Self::Triangle),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Voice {
    pub oscillator: Oscillator,
    pub frequency: f64,
    pub sample_rate: f64,
    /// One-pole low-pass coefficient.
    pub alpha: f64,
    pub attack: f64,
    pub decay: f64,
    pub sustain: f64,
    pub release: f64,
    /// Seconds from note start to note off; the release follows.
    pub note_duration: f64,
    pub velocity_gain: f64,
}

/// Adds one note into `out`, starting at sample `note_start` (may be negative) and lasting
/// `note_total` samples. Samples outside `out` are skipped; the filter starts at the first
/// sample inside it.
pub fn render_voice(out: &mut [f64], voice: &Voice, note_start: i64, note_total: i64) {
    VoiceState::new(*voice, note_start, note_total).render(out, 0);
}

/// A note being played block by block (the studio preview). Rendering a note in blocks makes
/// exactly the samples `render_voice` makes in one call.
#[derive(Clone, Copy, Debug)]
pub struct VoiceState {
    pub voice: Voice,
    /// Frame the note starts on.
    pub start: i64,
    /// Length in frames, including the release.
    pub total: i64,
    /// The next sample of the note to render.
    next: i64,
    filtered: f64,
}

impl VoiceState {
    pub fn new(voice: Voice, start: i64, total: i64) -> Self {
        Self {
            voice,
            start,
            total,
            next: 0,
            filtered: 0.0,
        }
    }

    pub fn finished(&self) -> bool {
        self.next >= self.total
    }

    /// Note off at `frame`: the release starts there unless it already has. A note that hasn't
    /// started yet is cut entirely.
    pub fn release_at(&mut self, frame: i64) {
        let at = (frame - self.start) as f64 / self.voice.sample_rate;
        if at <= 0.0 {
            self.total = 0;
        } else if at < self.voice.note_duration {
            self.voice.note_duration = at;
            let end = ((at + self.voice.release) * self.voice.sample_rate).round() as i64;
            self.total = self.total.min(end);
        }
    }

    /// Adds the note's samples for frames `block_start .. block_start + out.len()`. Frames the
    /// note already rendered are not rendered again; frames before the block that it never
    /// rendered are skipped without touching the filter.
    pub fn render(&mut self, out: &mut [f64], block_start: i64) {
        let first = self.next.max(block_start - self.start);
        let end = self.total.min(block_start + out.len() as i64 - self.start);
        let voice = &self.voice;
        let dt = voice.frequency / voice.sample_rate;
        let Voice {
            attack,
            decay,
            sustain,
            release,
            ..
        } = *voice;
        let mut filtered = self.filtered;
        for sample_index in first..end {
            let time = sample_index as f64 / voice.sample_rate;
            let phase = time * voice.frequency;
            let cycle = phase - phase.floor();
            let raw = match voice.oscillator {
                Oscillator::Sine => sine_cycle(cycle),
                Oscillator::Square => {
                    let naive = if cycle < 0.5 { 1.0 } else { -1.0 };
                    let half = cycle + 0.5;
                    let shifted = if half >= 1.0 { half - 1.0 } else { half };
                    naive + poly_blep(cycle, dt) - poly_blep(shifted, dt)
                }
                Oscillator::Sawtooth => 2.0 * cycle - 1.0 - poly_blep(cycle, dt),
                Oscillator::Triangle => {
                    if cycle < 0.5 {
                        4.0 * cycle - 1.0
                    } else {
                        3.0 - 4.0 * cycle
                    }
                }
            };
            filtered += voice.alpha * (raw - filtered);

            let envelope = if time < attack {
                if attack > 0.0 {
                    time / attack
                } else {
                    1.0
                }
            } else {
                let since_decay_start = time - attack;
                if since_decay_start < decay {
                    if decay > 0.0 {
                        1.0 - (1.0 - sustain) * (since_decay_start / decay)
                    } else {
                        sustain
                    }
                } else if time < voice.note_duration {
                    sustain
                } else {
                    let since_release = time - voice.note_duration;
                    if since_release >= release {
                        0.0
                    } else if release > 0.0 {
                        sustain * (1.0 - since_release / release)
                    } else {
                        0.0
                    }
                }
            };

            out[(self.start + sample_index - block_start) as usize] +=
                filtered * envelope * voice.velocity_gain;
        }
        if end > first {
            self.filtered = filtered;
            self.next = end;
        }
    }
}

/// PolyBLEP residual for a unit step at phase 0, for phase `t` in [0, 1) and phase increment
/// `dt`. Subtracting it from a naive saw (or adding at each square edge) removes most aliasing.
pub fn poly_blep(t: f64, dt: f64) -> f64 {
    if t < dt {
        let x = t / dt;
        x + x - x * x - 1.0
    } else if t > 1.0 - dt {
        let x = (t - 1.0) / dt;
        x * x + x + x + 1.0
    } else {
        0.0
    }
}

/// `sin(2π · cycle)` for `cycle` in [0, 1), from fixed polynomials so every platform agrees.
/// Accurate to about one unit in the last place.
pub fn sine_cycle(cycle: f64) -> f64 {
    let quarter = cycle * 4.0;
    let quadrant = quarter.floor();
    let r = quarter - quadrant;
    // sin(r·π/2) for the rising quarters, cos(r·π/2) for the falling ones; each is folded so
    // the polynomial argument stays within [0, π/4].
    let rising = if r <= 0.5 {
        sin_poly(r * FRAC_PI_2)
    } else {
        cos_poly((1.0 - r) * FRAC_PI_2)
    };
    let falling = if r <= 0.5 {
        cos_poly(r * FRAC_PI_2)
    } else {
        sin_poly((1.0 - r) * FRAC_PI_2)
    };
    match quadrant as u32 {
        0 => rising,
        1 => falling,
        2 => -rising,
        _ => -falling,
    }
}

/// Taylor series for sin on [0, π/4], through x^17.
fn sin_poly(x: f64) -> f64 {
    let x2 = x * x;
    x * (1.0
        + x2 * (-1.0 / 6.0
            + x2 * (1.0 / 120.0
                + x2 * (-1.0 / 5_040.0
                    + x2 * (1.0 / 362_880.0
                        + x2 * (-1.0 / 39_916_800.0
                            + x2 * (1.0 / 6_227_020_800.0
                                + x2 * (-1.0 / 1_307_674_368_000.0
                                    + x2 * (1.0 / 355_687_428_096_000.0)))))))))
}

/// Taylor series for cos on [0, π/4], through x^18.
fn cos_poly(x: f64) -> f64 {
    let x2 = x * x;
    1.0 + x2
        * (-0.5
            + x2 * (1.0 / 24.0
                + x2 * (-1.0 / 720.0
                    + x2 * (1.0 / 40_320.0
                        + x2 * (-1.0 / 3_628_800.0
                            + x2 * (1.0 / 479_001_600.0
                                + x2 * (-1.0 / 87_178_291_200.0
                                    + x2 * (1.0 / 20_922_789_888_000.0
                                        + x2 * (-1.0 / 6_402_373_705_728_000.0)))))))))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voice(oscillator: Oscillator) -> Voice {
        Voice {
            oscillator,
            frequency: 440.0,
            sample_rate: 48_000.0,
            alpha: 1.0,
            attack: 0.0,
            decay: 0.0,
            sustain: 1.0,
            release: 0.0,
            note_duration: 1.0,
            velocity_gain: 1.0,
        }
    }

    #[test]
    fn sine_matches_the_platform_sine_closely() {
        for i in 0..100_000 {
            let cycle = i as f64 / 100_000.0;
            let expected = (2.0 * core::f64::consts::PI * cycle).sin();
            assert!(
                (sine_cycle(cycle) - expected).abs() < 1e-15,
                "cycle {cycle}"
            );
        }
    }

    #[test]
    fn poly_blep_is_zero_away_from_the_edge_and_continuous_at_it() {
        let dt = 0.01;
        assert_eq!(poly_blep(0.5, dt), 0.0);
        // A naive saw jumps from 1 to -1 at the wrap; minus the residual, both sides are 0.
        assert_eq!(poly_blep(0.0, dt), -1.0);
        assert!((poly_blep(1.0 - 1e-12, dt) - 1.0).abs() < 1e-9);
        assert_eq!(poly_blep(dt, dt), 0.0);
        assert_eq!(poly_blep(1.0 - dt, dt), 0.0);
    }

    #[test]
    fn band_limited_saw_has_far_less_energy_above_nyquist_folding() {
        // A high saw's naive harmonics fold back below Nyquist as inharmonic tones. Measure the
        // energy at a frequency that is not a harmonic of the note; PolyBLEP must cut it.
        let sample_rate = 48_000.0;
        let frequency = 3_150.0;
        let n = 48_000;
        let probe = 1_000.0; // not a multiple of 3150 Hz, so any energy here is aliasing
        let energy = |saw: &dyn Fn(f64, f64) -> f64| {
            let (mut re, mut im) = (0.0, 0.0);
            for i in 0..n {
                let t = i as f64 / sample_rate;
                let phase = t * frequency;
                let cycle = phase - phase.floor();
                let value = saw(cycle, frequency / sample_rate);
                let angle = 2.0 * core::f64::consts::PI * probe * t;
                re += value * angle.cos();
                im += value * angle.sin();
            }
            (re * re + im * im).sqrt() / n as f64
        };
        let naive = energy(&|c, _| 2.0 * c - 1.0);
        let blep = energy(&|c, dt| 2.0 * c - 1.0 - poly_blep(c, dt));
        assert!(blep < naive / 10.0, "naive {naive}, polyblep {blep}");
    }

    #[test]
    fn notes_are_clipped_to_the_buffer() {
        let mut out = vec![0.0; 10];
        render_voice(&mut out, &voice(Oscillator::Triangle), -4, 8);
        assert!(out[..4].iter().all(|s| *s != 0.0));
        assert!(out[4..].iter().all(|s| *s == 0.0));

        let mut out = vec![0.0; 10];
        render_voice(&mut out, &voice(Oscillator::Triangle), 7, 100);
        assert!(out[..7].iter().all(|s| *s == 0.0));
        assert!(out[7..].iter().all(|s| *s != 0.0));
    }

    #[test]
    fn rendering_in_blocks_matches_rendering_at_once() {
        for oscillator in [
            Oscillator::Sine,
            Oscillator::Square,
            Oscillator::Sawtooth,
            Oscillator::Triangle,
        ] {
            let params = Voice {
                alpha: 0.3,
                attack: 0.002,
                decay: 0.01,
                sustain: 0.5,
                release: 0.004,
                note_duration: 0.02,
                ..voice(oscillator)
            };
            let mut whole = vec![0.0; 2_000];
            render_voice(&mut whole, &params, 37, 1_500);

            let mut state = VoiceState::new(params, 37, 1_500);
            let mut blocks = vec![0.0; 2_000];
            for (index, block) in blocks.chunks_mut(128).enumerate() {
                state.render(block, index as i64 * 128);
            }
            assert_eq!(whole, blocks, "{oscillator:?}");
            assert!(state.finished());
        }
    }

    #[test]
    fn release_shortens_a_held_note_and_cuts_one_not_yet_started() {
        let params = Voice {
            release: 0.01,
            ..voice(Oscillator::Sine)
        };
        let mut held = VoiceState::new(params, 0, 48_480);
        held.release_at(4_800);
        assert_eq!(held.voice.note_duration, 0.1);
        assert_eq!(held.total, 5_280);

        let mut future = VoiceState::new(params, 9_600, 48_480);
        future.release_at(4_800);
        assert!(future.finished());
    }

    #[test]
    fn voices_add_into_the_buffer() {
        let mut once = vec![0.0; 64];
        render_voice(&mut once, &voice(Oscillator::Triangle), 0, 64);
        let mut twice = once.clone();
        render_voice(&mut twice, &voice(Oscillator::Triangle), 0, 64);
        for (a, b) in once.iter().zip(&twice) {
            assert_eq!(*b, a + a);
        }
    }
}
