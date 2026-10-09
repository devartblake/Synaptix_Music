//! The instrument voice: oscillator -> one-pole low-pass -> ADSR -> velocity.
//!
//! One implementation for the offline renderer and the studio preview, so exports and
//! preview make the same samples. Everything is plain IEEE-754 `f64` arithmetic in a fixed order
//! (no fused multiply-add, no platform `sin`), so a render is bit-identical on every machine and
//! matches the TypeScript reference in `packages/dsp-kernel/src/kernel.test.ts`.

use core::f64::consts::FRAC_PI_2;

/// 1 / 2π.
const FRAC_1_2PI: f64 = 0.159_154_943_091_895_35;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Oscillator {
    Sine,
    /// Band-limited (PolyBLEP) square.
    Square,
    /// Band-limited (PolyBLEP) sawtooth.
    Sawtooth,
    Triangle,
    /// Seven detuned band-limited saws (supersaw / unison).
    Supersaw,
    /// Karplus–Strong plucked string: a seeded noise burst circulating in a tuned, lossy delay.
    PluckedString,
    /// Two-operator FM with an inharmonic ratio: glassy bell.
    FmBell,
    /// Two-operator FM with a harmonic ratio and a fast-falling index: DX-style electric piano.
    FmPiano,
    /// A drum kit: the note picks the drum (General MIDI drum map), each synthesized from
    /// pitched sines and seeded noise.
    DrumKit,
    /// 808 bass: a sine that drops from 2.5× the note's pitch onto it, softly saturated.
    Bass808,
    /// Band-limited 25% pulse, centred on zero: the classic retro game lead.
    Pulse25,
}

/// How hard the 808 drives its soft clipper (higher is grittier).
pub const BASS_808_DRIVE: f64 = 2.2;

/// A two-operator FM preset: a sine modulator at `ratio` × the note frequency phase-modulates a
/// sine carrier. The index (brightness) falls from `start` towards `end` as
/// `end + (start - end) / (1 + time · fall)`: a division, not `exp`, so it is the same on every
/// platform.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FmPreset {
    pub ratio: f64,
    pub start: f64,
    pub end: f64,
    pub fall: f64,
}

pub const FM_BELL: FmPreset = FmPreset {
    ratio: 3.5,
    start: 5.0,
    end: 0.5,
    fall: 4.0,
};
pub const FM_PIANO: FmPreset = FmPreset {
    ratio: 1.0,
    start: 2.5,
    end: 0.3,
    fall: 12.0,
};

/// How much of each pass around the string survives (higher rings longer).
pub const STRING_FEEDBACK: f64 = 0.996;

/// Supersaw voices: frequency ratios (spread about ±19 cents), starting phases (fixed, so
/// renders stay deterministic, and spread so the voices don't start in phase), and levels.
pub const SUPERSAW_RATIOS: [f64; 7] = [0.989, 0.9937, 0.998, 1.0, 1.002, 1.0063, 1.011];
pub const SUPERSAW_PHASES: [f64; 7] = [0.37, 0.71, 0.13, 0.0, 0.53, 0.89, 0.29];
pub const SUPERSAW_LEVELS: [f64; 7] = [0.6, 0.6, 0.6, 1.0, 0.6, 0.6, 0.6];
/// Brings the sum back to about one saw's loudness: 1 / (1 + 0.6·√6), rounded.
pub const SUPERSAW_GAIN: f64 = 0.405;
/// Where each supersaw saw sits in the stereo field (−1 left … 1 right). Alternating sides, so
/// neither side gets all the flat or all the sharp saws.
pub const SUPERSAW_PANS: [f64; 7] = [-0.8, 0.53, -0.27, 0.0, 0.27, -0.53, 0.8];

impl Oscillator {
    /// Codes shared with the TypeScript side.
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Sine),
            1 => Some(Self::Square),
            2 => Some(Self::Sawtooth),
            3 => Some(Self::Triangle),
            4 => Some(Self::Supersaw),
            5 => Some(Self::PluckedString),
            6 => Some(Self::FmBell),
            7 => Some(Self::FmPiano),
            8 => Some(Self::DrumKit),
            9 => Some(Self::Bass808),
            10 => Some(Self::Pulse25),
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
    /// Seeds the plucked string's noise burst (derived from the note, so preview and export
    /// agree); other oscillators ignore it.
    pub seed: u32,
    /// Cutoff in Hz, for the resonant filter (the one-pole filter uses `alpha`).
    pub cutoff: f64,
    /// 0 keeps the original one-pole low-pass (6 dB); above 0 switches to a 12 dB resonant
    /// state-variable low-pass, peaking more as it rises to 1.
    pub resonance: f64,
    /// Modulation; all zero (the default) leaves the voice exactly as without it.
    pub modulation: Modulation,
}

/// Per-voice modulation: one sine LFO routed to pitch, cutoff and level, and a filter envelope
/// that starts the cutoff higher and decays onto it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Modulation {
    /// LFO speed in Hz.
    pub lfo_rate: f64,
    /// Vibrato depth in cents (pitch swings ± this much).
    pub vibrato_cents: f64,
    /// Cutoff swing in octaves (±).
    pub lfo_cutoff_octaves: f64,
    /// Tremolo depth, 0–1 (level dips by up to this much).
    pub tremolo: f64,
    /// How many octaves above the cutoff the filter envelope starts.
    pub filter_env_octaves: f64,
    /// Seconds for the filter envelope to fall to a quarter of its amount.
    pub filter_env_decay: f64,
}

impl Modulation {
    fn vibrato(&self) -> bool {
        self.vibrato_cents > 0.0 && self.lfo_rate > 0.0
    }
    fn moves_cutoff(&self) -> bool {
        (self.lfo_cutoff_octaves > 0.0 && self.lfo_rate > 0.0)
            || (self.filter_env_octaves > 0.0 && self.filter_env_decay > 0.0)
    }
    fn tremolo(&self) -> bool {
        self.tremolo > 0.0 && self.lfo_rate > 0.0
    }
}

/// Samples between updates of a moving cutoff (0.33 ms at 48 kHz): smooth for an LFO or filter
/// envelope, and far cheaper than recomputing the filter every sample.
pub const CONTROL_INTERVAL: i64 = 16;

/// 2^x from a fixed series, so every platform agrees (x clamped to ±20 octaves).
pub fn exp2(x: f64) -> f64 {
    let x = x.clamp(-20.0, 20.0);
    let whole = x.floor();
    let y = (x - whole) * core::f64::consts::LN_2;
    // e^y for y in [0, ln 2): Taylor series through y^14 (error below 1e-16).
    let mut term = 1.0;
    let mut sum = 1.0;
    for n in 1..=14 {
        term *= y / n as f64;
        sum += term;
    }
    sum * f64::from_bits(((whole as i64 + 1023) as u64) << 52)
}

/// tan(π · fraction) for a cutoff as a fraction of the sample rate, from the kernel's sine.
fn tan_of_cutoff(cutoff: f64, sample_rate: f64) -> f64 {
    let cycle = (cutoff / sample_rate).clamp(0.0, 0.49) * 0.5;
    sine_cycle(cycle) / sine_cycle(cycle + 0.25)
}

/// Adds one note into `left` and `right` (the same length), starting at sample `note_start`
/// (may be negative) and lasting `note_total` samples. Samples outside the buffers are skipped;
/// the filter starts at the first sample inside them. Most voices are mono and write the same
/// samples to both channels; the supersaw spreads its saws across them.
pub fn render_voice(
    left: &mut [f64],
    right: &mut [f64],
    voice: &Voice,
    note_start: i64,
    note_total: i64,
) {
    VoiceState::new(*voice, note_start, note_total).render(left, right, 0);
}

/// A Karplus–Strong string: a delay line one period long, filled with noise, fed back through a
/// two-point average (the loss that makes it decay and mellow) and a first-order all-pass that
/// tunes the fractional part of the period.
#[derive(Clone, Debug)]
struct PluckedString {
    line: Vec<f64>,
    position: usize,
    previous: f64,
    allpass: f64,
    allpass_input: f64,
    allpass_output: f64,
}

impl PluckedString {
    fn new(frequency: f64, sample_rate: f64, seed: u32) -> Self {
        // Loop delay = whole samples + 0.5 (average) + the all-pass delay, kept in [0.1, 1.1).
        let period = sample_rate / frequency;
        let whole = ((period - 0.6).floor() as usize).max(1);
        let fraction = period - 0.5 - whole as f64;
        let mut state = if seed == 0 { 0x9E37_79B9 } else { seed };
        let mut line: Vec<f64> = (0..whole)
            .map(|_| {
                // xorshift32
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                state as f64 / 2_147_483_648.0 - 1.0
            })
            .collect();
        // Without its mean the burst carries no DC, which would ring on as an offset.
        let mean = line.iter().sum::<f64>() / whole as f64;
        for sample in &mut line {
            *sample -= mean;
        }
        Self {
            line,
            position: 0,
            previous: 0.0,
            allpass: (1.0 - fraction) / (1.0 + fraction),
            allpass_input: 0.0,
            allpass_output: 0.0,
        }
    }

    fn next(&mut self) -> f64 {
        let out = self.line[self.position];
        let average = 0.5 * (out + self.previous);
        self.previous = out;
        let tuned =
            self.allpass * average + self.allpass_input - self.allpass * self.allpass_output;
        self.allpass_input = average;
        self.allpass_output = tuned;
        self.line[self.position] = tuned * STRING_FEEDBACK;
        self.position += 1;
        if self.position == self.line.len() {
            self.position = 0;
        }
        out
    }
}

/// A note being played block by block (the studio preview). Rendering a note in blocks makes
/// exactly the samples `render_voice` makes in one call.
#[derive(Clone, Debug)]
pub struct VoiceState {
    pub voice: Voice,
    /// Frame the note starts on.
    pub start: i64,
    /// Length in frames, including the release.
    pub total: i64,
    /// The next sample of the note to render.
    next: i64,
    filtered: f64,
    /// Resonant filter state (its two integrators).
    svf_1: f64,
    svf_2: f64,
    /// The right channel's filter state, for stereo voices (mono voices filter once).
    filtered_right: f64,
    svf_right_1: f64,
    svf_right_2: f64,
    /// Phase of an oscillator whose pitch moves (808), integrated sample by sample.
    sweep_phase: f64,
    string: Option<PluckedString>,
    drum: Option<Drum>,
}

impl VoiceState {
    pub fn new(voice: Voice, start: i64, total: i64) -> Self {
        Self {
            voice,
            start,
            total,
            next: 0,
            filtered: 0.0,
            svf_1: 0.0,
            svf_2: 0.0,
            filtered_right: 0.0,
            svf_right_1: 0.0,
            svf_right_2: 0.0,
            sweep_phase: 0.0,
            string: (voice.oscillator == Oscillator::PluckedString)
                .then(|| PluckedString::new(voice.frequency, voice.sample_rate, voice.seed)),
            drum: (voice.oscillator == Oscillator::DrumKit)
                .then(|| Drum::new(voice.frequency, voice.sample_rate, voice.seed)),
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

    /// Adds the note's samples for frames `block_start .. block_start + left.len()`. Frames the
    /// note already rendered are not rendered again; frames before the block that it never
    /// rendered are skipped without touching the filter.
    pub fn render(&mut self, left: &mut [f64], right: &mut [f64], block_start: i64) {
        let first = self.next.max(block_start - self.start);
        let end = self.total.min(block_start + left.len() as i64 - self.start);
        let voice = &self.voice;
        let dt = voice.frequency / voice.sample_rate;
        let Voice {
            attack,
            decay,
            sustain,
            release,
            ..
        } = *voice;
        let supersaw_frequencies = SUPERSAW_RATIOS.map(|ratio| voice.frequency * ratio);
        let supersaw_dts = supersaw_frequencies.map(|frequency| frequency / voice.sample_rate);
        let stereo = voice.oscillator == Oscillator::Supersaw;
        // Equal-power pan per saw, scaled by √2 so a centred saw is at full level on both sides.
        let pan_gain =
            |pan: f64, side: f64| core::f64::consts::SQRT_2 * sine_cycle((pan + 1.0) / 8.0 + side);
        let supersaw_left = SUPERSAW_PANS.map(|pan| pan_gain(pan, 0.25)); // cos
        let supersaw_right = SUPERSAW_PANS.map(|pan| pan_gain(pan, 0.0)); // sin
        let fm = match voice.oscillator {
            Oscillator::FmPiano => FM_PIANO,
            _ => FM_BELL,
        };
        let modulator_frequency = voice.frequency * fm.ratio;
        let mut filtered = self.filtered;
        let resonant = voice.resonance > 0.0;
        let mut svf = ResonantLowPass::new(voice.cutoff, voice.sample_rate, voice.resonance);
        let modulation = voice.modulation;
        let (vibrato, moves_cutoff, tremolo) = (
            modulation.vibrato(),
            modulation.moves_cutoff(),
            modulation.tremolo(),
        );
        // Vibrato as a time warp: frequency × (1 + k·sin(2π·rate·t)) integrates to the phase of
        // t + k·(1 − cos(2π·rate·t)) / (2π·rate), so every oscillator's phase stays closed-form.
        let vibrato_depth = (exp2(modulation.vibrato_cents / 1_200.0) - 1.0)
            / (2.0 * core::f64::consts::PI * modulation.lfo_rate);
        let mut alpha = voice.alpha;
        let (mut svf_1, mut svf_2) = (self.svf_1, self.svf_2);
        let mut filtered_right = self.filtered_right;
        let (mut svf_right_1, mut svf_right_2) = (self.svf_right_1, self.svf_right_2);
        let mut string = self.string.take();
        let mut drum = self.drum.take();
        let mut sweep_phase = self.sweep_phase;
        for sample_index in first..end {
            let time = sample_index as f64 / voice.sample_rate;
            let lfo_cycle = time * modulation.lfo_rate;
            let lfo_cycle = lfo_cycle - lfo_cycle.floor();
            // The oscillators' clock: real time, or warped by the vibrato.
            let clock = if vibrato {
                time + vibrato_depth * (1.0 - sine_cycle(lfo_cycle + 0.25))
            } else {
                time
            };
            // The moving cutoff updates at control rate: on a grid every CONTROL_INTERVAL
            // samples from the note's start (and at a block's first sample, from the grid point
            // before it), so block boundaries never change the result.
            if moves_cutoff && (sample_index % CONTROL_INTERVAL == 0 || sample_index == first) {
                let control_time =
                    (sample_index - sample_index % CONTROL_INTERVAL) as f64 / voice.sample_rate;
                let control_lfo = control_time * modulation.lfo_rate;
                let mut octaves = 0.0;
                if modulation.lfo_cutoff_octaves > 0.0 {
                    octaves += modulation.lfo_cutoff_octaves
                        * sine_cycle(control_lfo - control_lfo.floor());
                }
                if modulation.filter_env_octaves > 0.0 && modulation.filter_env_decay > 0.0 {
                    let fall = 1.0 / (1.0 + control_time / modulation.filter_env_decay);
                    octaves += modulation.filter_env_octaves * fall * fall;
                }
                let cutoff = (voice.cutoff * exp2(octaves)).max(20.0);
                if resonant {
                    svf = ResonantLowPass::new(cutoff, voice.sample_rate, voice.resonance);
                } else {
                    // A moving one-pole cutoff: tan-based (deterministic) rather than the static
                    // path's exp.
                    let g = tan_of_cutoff(cutoff, voice.sample_rate);
                    alpha = g / (1.0 + g);
                }
            }
            let phase = clock * voice.frequency;
            let cycle = phase - phase.floor();
            // The right channel's raw signal, for stereo voices.
            let mut raw_right = 0.0;
            let raw = match voice.oscillator {
                Oscillator::PluckedString => string.as_mut().map_or(0.0, PluckedString::next),
                Oscillator::DrumKit => drum.as_mut().map_or(0.0, |drum| drum.next(time)),
                Oscillator::Bass808 => {
                    let tone = sine_cycle(sweep_phase - sweep_phase.floor());
                    let pitch = voice.frequency * (1.0 + 1.5 / (1.0 + time * 35.0));
                    sweep_phase += pitch / voice.sample_rate;
                    soft_clip(tone * BASS_808_DRIVE) / soft_clip(BASS_808_DRIVE)
                }
                Oscillator::FmBell | Oscillator::FmPiano => {
                    let modulator_phase = clock * modulator_frequency;
                    let modulator = sine_cycle(modulator_phase - modulator_phase.floor());
                    let index = fm.end + (fm.start - fm.end) / (1.0 + time * fm.fall);
                    // Phase modulation in cycles: index radians is index / 2π cycles.
                    let carrier = cycle + index * modulator * FRAC_1_2PI;
                    sine_cycle(carrier - carrier.floor())
                }
                Oscillator::Supersaw => {
                    let (mut sum_left, mut sum_right) = (0.0, 0.0);
                    for k in 0..7 {
                        let phase = clock * supersaw_frequencies[k] + SUPERSAW_PHASES[k];
                        let cycle = phase - phase.floor();
                        let saw = SUPERSAW_LEVELS[k]
                            * (2.0 * cycle - 1.0 - poly_blep(cycle, supersaw_dts[k]));
                        sum_left += saw * supersaw_left[k];
                        sum_right += saw * supersaw_right[k];
                    }
                    raw_right = sum_right * SUPERSAW_GAIN;
                    sum_left * SUPERSAW_GAIN
                }
                Oscillator::Sine => sine_cycle(cycle),
                Oscillator::Square => {
                    let naive = if cycle < 0.5 { 1.0 } else { -1.0 };
                    let half = cycle + 0.5;
                    let shifted = if half >= 1.0 { half - 1.0 } else { half };
                    naive + poly_blep(cycle, dt) - poly_blep(shifted, dt)
                }
                Oscillator::Sawtooth => 2.0 * cycle - 1.0 - poly_blep(cycle, dt),
                Oscillator::Pulse25 => {
                    // High for the first quarter of each cycle; edges at 0 and 0.25 are
                    // band-limited, and the mean (2·0.25 − 1 = −0.5) is removed.
                    let naive = if cycle < 0.25 { 1.0 } else { -1.0 };
                    let fall = cycle + 0.75;
                    let shifted = if fall >= 1.0 { fall - 1.0 } else { fall };
                    naive + poly_blep(cycle, dt) - poly_blep(shifted, dt) + 0.5
                }
                Oscillator::Triangle => {
                    if cycle < 0.5 {
                        4.0 * cycle - 1.0
                    } else {
                        3.0 - 4.0 * cycle
                    }
                }
            };
            if resonant {
                filtered = svf.process(raw, &mut svf_1, &mut svf_2);
            } else {
                filtered += alpha * (raw - filtered);
            }
            if stereo {
                if resonant {
                    filtered_right = svf.process(raw_right, &mut svf_right_1, &mut svf_right_2);
                } else {
                    filtered_right += alpha * (raw_right - filtered_right);
                }
            }

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

            let index = (self.start + sample_index - block_start) as usize;
            // Tremolo dips the level by up to its depth, in time with the LFO.
            let envelope = if tremolo {
                envelope * (1.0 - modulation.tremolo * 0.5 * (1.0 - sine_cycle(lfo_cycle)))
            } else {
                envelope
            };
            let value = filtered * envelope * voice.velocity_gain;
            left[index] += value;
            right[index] += if stereo {
                filtered_right * envelope * voice.velocity_gain
            } else {
                value
            };
        }
        self.string = string;
        self.drum = drum;
        if end > first {
            self.sweep_phase = sweep_phase;
            self.filtered = filtered;
            self.svf_1 = svf_1;
            self.svf_2 = svf_2;
            self.filtered_right = filtered_right;
            self.svf_right_1 = svf_right_1;
            self.svf_right_2 = svf_right_2;
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

/// A 12 dB resonant low-pass: the topology-preserving state-variable filter. Its coefficient
/// needs tan(π·fc/fs), computed from the kernel's own sine and cosine so every platform agrees.
#[derive(Clone, Copy, Debug)]
struct ResonantLowPass {
    a1: f64,
    a2: f64,
    a3: f64,
}

impl ResonantLowPass {
    fn new(cutoff: f64, sample_rate: f64, resonance: f64) -> Self {
        // Below Nyquist, where tan stays finite.
        let g = tan_of_cutoff(cutoff, sample_rate);
        // Damping from 2 (no peak) down to 0.1 (a strong peak, about +20 dB) as resonance → 1.
        let k = 2.0 - 1.9 * resonance.clamp(0.0, 1.0);
        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        Self { a1, a2, a3: g * a2 }
    }

    fn process(&self, input: f64, ic1: &mut f64, ic2: &mut f64) -> f64 {
        let v3 = input - *ic2;
        let v1 = self.a1 * *ic1 + self.a2 * v3;
        let v2 = *ic2 + self.a2 * *ic1 + self.a3 * v3;
        *ic1 = 2.0 * v1 - *ic1;
        *ic2 = 2.0 * v2 - *ic2;
        v2
    }
}

/// Saturation by division, `x / (1 + |x|)`: smooth, odd, and the same on every platform.
pub fn soft_clip(x: f64) -> f64 {
    x / (1.0 + x.abs())
}

/// The MIDI note nearest `frequency` (A4 = 440 Hz), found by comparison only so every platform
/// agrees. Notes are half a semitone from the boundaries, far beyond any rounding.
pub fn midi_note(frequency: f64) -> i32 {
    const SEMITONE: f64 = 1.059_463_094_359_295_3; // 2^(1/12)
    const HALF_SEMITONE: f64 = 1.029_302_236_643_492; // 2^(1/24)
    let (mut note, mut reference) = (69, 440.0);
    while frequency > reference * HALF_SEMITONE {
        reference *= SEMITONE;
        note += 1;
    }
    while frequency < reference / HALF_SEMITONE && note > 0 {
        reference /= SEMITONE;
        note -= 1;
    }
    note
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DrumPiece {
    Kick,
    Rim,
    Snare,
    Clap,
    ClosedHat,
    OpenHat,
    Crash,
    Ride,
    /// Any other note: a tom tuned to the note.
    Tom,
}

impl DrumPiece {
    /// General MIDI drum map, with the low end all kick and unmapped notes as tuned toms.
    pub fn for_note(note: i32) -> Self {
        match note {
            ..=36 => Self::Kick,
            37 => Self::Rim,
            38 | 40 => Self::Snare,
            39 => Self::Clap,
            42 | 44 => Self::ClosedHat,
            46 => Self::OpenHat,
            49 | 52 | 55 | 57 => Self::Crash,
            51 | 53 | 59 => Self::Ride,
            _ => Self::Tom,
        }
    }
}

/// `1 / (1 + rate·t)²`: a fast-then-slow decay from 1, by division (no `exp`).
fn decay(time: f64, rate: f64) -> f64 {
    let d = 1.0 / (1.0 + rate * time);
    d * d
}

/// One drum hit. Its pitched parts integrate their frequency sample by sample (pitch drops), and
/// its noise is xorshift32 seeded from the note, through one-pole high- and low-pass filters.
#[derive(Clone, Debug)]
struct Drum {
    piece: DrumPiece,
    frequency: f64,
    sample_rate: f64,
    phase: f64,
    noise: u32,
    high_pass: f64,
    high_pass_input: f64,
    high_pass_output: f64,
    high_pass_2_input: f64,
    high_pass_2_output: f64,
    low_pass: f64,
    low_pass_output: f64,
}

impl Drum {
    fn new(frequency: f64, sample_rate: f64, seed: u32) -> Self {
        let piece = DrumPiece::for_note(midi_note(frequency));
        let (high_pass_hz, low_pass_hz) = match piece {
            DrumPiece::Kick => (60.0, 4_000.0),
            DrumPiece::Rim => (2_000.0, 12_000.0),
            DrumPiece::Snare => (1_500.0, 9_000.0),
            DrumPiece::Clap => (900.0, 2_600.0),
            DrumPiece::ClosedHat | DrumPiece::OpenHat => (7_000.0, 20_000.0),
            DrumPiece::Crash => (4_500.0, 20_000.0),
            DrumPiece::Ride => (6_000.0, 20_000.0),
            DrumPiece::Tom => (200.0, 3_000.0),
        };
        // One-pole coefficients from the cutoff, by division: w = 2π·fc / sample rate.
        let w = |hz: f64| 2.0 * core::f64::consts::PI * hz / sample_rate;
        Self {
            piece,
            frequency,
            sample_rate,
            phase: 0.0,
            noise: if seed == 0 { 0x9E37_79B9 } else { seed },
            high_pass: 1.0 / (1.0 + w(high_pass_hz)),
            high_pass_input: 0.0,
            high_pass_output: 0.0,
            high_pass_2_input: 0.0,
            high_pass_2_output: 0.0,
            low_pass: w(low_pass_hz) / (1.0 + w(low_pass_hz)),
            low_pass_output: 0.0,
        }
    }

    /// White noise through the drum's high-pass (twice, for cymbals) and low-pass.
    fn noise(&mut self, twice: bool) -> f64 {
        self.noise ^= self.noise << 13;
        self.noise ^= self.noise >> 17;
        self.noise ^= self.noise << 5;
        let white = self.noise as f64 / 2_147_483_648.0 - 1.0;
        let high = self.high_pass * (self.high_pass_output + white - self.high_pass_input);
        self.high_pass_input = white;
        self.high_pass_output = high;
        let mut out = high;
        if twice {
            let high_2 = self.high_pass * (self.high_pass_2_output + high - self.high_pass_2_input);
            self.high_pass_2_input = high;
            self.high_pass_2_output = high_2;
            out = high_2;
        }
        self.low_pass_output += self.low_pass * (out - self.low_pass_output);
        self.low_pass_output
    }

    /// Advances a pitched part at `frequency` and returns its sine.
    fn tone(&mut self, frequency: f64) -> f64 {
        let value = sine_cycle(self.phase - self.phase.floor());
        self.phase += frequency / self.sample_rate;
        value
    }

    fn next(&mut self, time: f64) -> f64 {
        match self.piece {
            DrumPiece::Kick => {
                let body = self.tone(48.0 + 112.0 / (1.0 + time * 35.0)) * decay(time, 9.0);
                body + 0.3 * self.noise(false) * decay(time, 400.0)
            }
            DrumPiece::Snare => {
                let body = self.tone(175.0 + 60.0 / (1.0 + time * 60.0)) * decay(time, 25.0);
                0.5 * body + 0.9 * self.noise(false) * decay(time, 14.0)
            }
            DrumPiece::Clap => {
                // Three quick bursts, then a short room tail.
                let mut level = 0.0;
                for offset in [0.0, 0.011, 0.022] {
                    if time >= offset {
                        level += decay(time - offset, 180.0);
                    }
                }
                if time >= 0.022 {
                    level += 0.5 * decay(time - 0.022, 12.0);
                }
                1.6 * self.noise(false) * level
            }
            DrumPiece::ClosedHat => 2.4 * self.noise(true) * decay(time, 70.0),
            DrumPiece::OpenHat => 2.0 * self.noise(true) * decay(time, 7.0),
            DrumPiece::Crash => 1.4 * self.noise(true) * decay(time, 1.5),
            DrumPiece::Ride => {
                let ping = self.tone(3_150.0) * decay(time, 6.0);
                0.9 * self.noise(true) * decay(time, 3.0) + 0.15 * ping
            }
            DrumPiece::Rim => {
                let click = self.tone(1_700.0) * decay(time, 220.0);
                0.6 * click + 0.4 * self.noise(false) * decay(time, 300.0)
            }
            DrumPiece::Tom => {
                let frequency = self.frequency;
                self.tone(frequency + 0.5 * frequency / (1.0 + time * 25.0)) * decay(time, 7.0)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Renders into `out`, the left channel (mono voices write the same samples to both).
    fn render_mono(out: &mut [f64], voice: &Voice, start: i64, total: i64) {
        let mut right = vec![0.0; out.len()];
        render_voice(out, &mut right, voice, start, total);
    }

    /// Rendering in 128-frame blocks must make exactly the samples of one whole render, on
    /// both channels, and finish the note.
    fn assert_blocks_match_whole(params: &Voice) {
        let (mut whole_left, mut whole_right) = (vec![0.0; 2_000], vec![0.0; 2_000]);
        render_voice(&mut whole_left, &mut whole_right, params, 37, 1_500);
        let mut state = VoiceState::new(*params, 37, 1_500);
        let (mut left, mut right) = (vec![0.0; 2_000], vec![0.0; 2_000]);
        for (index, (l, r)) in left.chunks_mut(128).zip(right.chunks_mut(128)).enumerate() {
            state.render(l, r, index as i64 * 128);
        }
        assert_eq!(whole_left, left, "{:?} left", params.oscillator);
        assert_eq!(whole_right, right, "{:?} right", params.oscillator);
        assert!(state.finished());
    }

    #[test]
    fn mono_voices_are_identical_on_both_sides_and_the_supersaw_is_wide() {
        let stereo = |oscillator| {
            let (mut left, mut right) = (vec![0.0; 24_000], vec![0.0; 24_000]);
            render_voice(&mut left, &mut right, &voice(oscillator), 0, 24_000);
            (left, right)
        };
        for oscillator in [
            Oscillator::Sawtooth,
            Oscillator::DrumKit,
            Oscillator::FmBell,
        ] {
            let (left, right) = stereo(oscillator);
            assert_eq!(left, right, "{oscillator:?}");
        }
        // The saws sit at different places, so the sides differ but stay related: correlation
        // well below 1 (mono) and well above 0 (unrelated), and balanced in level.
        let (left, right) = stereo(Oscillator::Supersaw);
        let dot = |a: &[f64], b: &[f64]| a.iter().zip(b).map(|(x, y)| x * y).sum::<f64>();
        let correlation = dot(&left, &right) / (dot(&left, &left) * dot(&right, &right)).sqrt();
        assert!(
            (0.2..0.9).contains(&correlation),
            "correlation {correlation}"
        );
        let balance = dot(&left, &left) / dot(&right, &right);
        assert!((0.7..1.4).contains(&balance), "left/right energy {balance}");
    }

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
            seed: 1,
            cutoff: 1_000.0,
            resonance: 0.0,
            modulation: Modulation::default(),
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
    fn resonance_peaks_at_the_cutoff_and_zero_keeps_the_original_filter() {
        // A 110 Hz saw has a harmonic at 990 Hz (the 9th). With the cutoff at 990 Hz, raising
        // the resonance must boost that harmonic relative to the fundamental.
        let render = |resonance: f64| {
            let params = Voice {
                frequency: 110.0,
                cutoff: 990.0,
                resonance,
                ..voice(Oscillator::Sawtooth)
            };
            let mut out = vec![0.0; 48_000];
            render_mono(&mut out, &params, 0, 48_000);
            out
        };
        let level = |out: &[f64], hz: f64| {
            let (mut re, mut im) = (0.0, 0.0);
            for (i, s) in out.iter().enumerate() {
                let angle = 2.0 * core::f64::consts::PI * hz * i as f64 / 48_000.0;
                re += s * angle.cos();
                im += s * angle.sin();
            }
            (re * re + im * im).sqrt()
        };
        let gentle = render(0.1);
        let sharp = render(0.9);
        let ratio = |out: &[f64]| level(out, 990.0) / level(out, 110.0);
        assert!(
            ratio(&sharp) > ratio(&gentle) * 4.0,
            "{} vs {}",
            ratio(&sharp),
            ratio(&gentle)
        );
        // Even at full resonance the filter stays stable.
        assert!(render(1.0).iter().all(|s| s.is_finite() && s.abs() < 20.0));

        // Resonance 0 is exactly the one-pole filter, whatever the cutoff field says.
        let one_pole = |cutoff| {
            let params = Voice {
                alpha: 0.2,
                cutoff,
                ..voice(Oscillator::Sawtooth)
            };
            let mut out = vec![0.0; 4_800];
            render_mono(&mut out, &params, 0, 4_800);
            out
        };
        assert_eq!(one_pole(500.0), one_pole(5_000.0));
    }

    #[test]
    fn resonant_notes_render_the_same_in_blocks() {
        let params = Voice {
            alpha: 0.3,
            cutoff: 2_000.0,
            resonance: 0.7,
            ..voice(Oscillator::Supersaw)
        };
        assert_blocks_match_whole(&params);
    }

    #[test]
    fn exp2_matches_the_platform_closely() {
        for i in -2_000..=2_000 {
            let x = i as f64 / 250.0;
            let expected = 2f64.powf(x);
            assert!(((exp2(x) - expected) / expected).abs() < 1e-14, "2^{x}");
        }
    }

    fn modulated(oscillator: Oscillator, modulation: Modulation) -> Vec<f64> {
        let params = Voice {
            // The one-pole coefficient for the same 800 Hz cutoff, as the TypeScript side computes it.
            alpha: 1.0 - (-2.0 * core::f64::consts::PI * 800.0 / 48_000.0).exp(),
            cutoff: 800.0,
            modulation,
            ..voice(oscillator)
        };
        let mut out = vec![0.0; 48_000];
        render_mono(&mut out, &params, 0, 48_000);
        out
    }

    #[test]
    fn modulation_with_no_depth_changes_nothing() {
        // A running LFO with every depth at zero must leave the voice byte-identical.
        let idle = Modulation {
            lfo_rate: 5.0,
            ..Modulation::default()
        };
        for oscillator in [
            Oscillator::Sawtooth,
            Oscillator::Supersaw,
            Oscillator::FmBell,
        ] {
            assert_eq!(
                modulated(oscillator, idle),
                modulated(oscillator, Modulation::default())
            );
        }
    }

    #[test]
    fn vibrato_swings_the_pitch_around_the_note() {
        // 440 Hz with ±200 cents at 2 Hz: the LFO's rising half-cycle (0–0.25 s) runs sharp
        // (about +34 Hz on average, so ~8 more crossings) and the falling half flat; over a whole
        // second the pitch averages back to the note.
        let out = modulated(
            Oscillator::Sine,
            Modulation {
                lfo_rate: 2.0,
                vibrato_cents: 200.0,
                ..Modulation::default()
            },
        );
        let crossings = |range: &[f64]| {
            range
                .windows(2)
                .filter(|w| w[0] < 0.0 && w[1] >= 0.0)
                .count()
        };
        let high = crossings(&out[0..12_000]);
        let low = crossings(&out[12_000..24_000]);
        assert!(high > low + 10, "high {high}, low {low}");
        let total = crossings(&out);
        assert!((438..=442).contains(&total), "{total} crossings in 1 s");
    }

    #[test]
    fn the_filter_envelope_opens_then_closes_the_cutoff() {
        // High-frequency share: energy of the sample-to-sample difference over the energy. (A
        // low-pass turns a saw's jumps into steep ramps, which the total change barely notices.)
        let brightness = |s: &[f64]| {
            let change: f64 = s.windows(2).map(|w| (w[1] - w[0]).powi(2)).sum();
            change / s.iter().map(|x| x * x).sum::<f64>()
        };
        let swept = modulated(
            Oscillator::Sawtooth,
            Modulation {
                filter_env_octaves: 4.0,
                filter_env_decay: 0.05,
                ..Modulation::default()
            },
        );
        let plain = modulated(Oscillator::Sawtooth, Modulation::default());
        // Bright at the start, settling back towards the unmodulated sound.
        let (early, late) = (brightness(&swept[..2_400]), brightness(&swept[40_000..]));
        let (plain_early, plain_late) = (brightness(&plain[..2_400]), brightness(&plain[40_000..]));
        assert!(
            early > 1.5 * plain_early,
            "early {early} vs plain {plain_early}"
        );
        assert!(late < 1.2 * plain_late, "late {late} vs plain {plain_late}");
    }

    #[test]
    fn tremolo_pulses_the_level_at_the_lfo_rate() {
        let out = modulated(
            Oscillator::Sine,
            Modulation {
                lfo_rate: 4.0,
                tremolo: 0.8,
                ..Modulation::default()
            },
        );
        let rms = |r: &[f64]| (r.iter().map(|x| x * x).sum::<f64>() / r.len() as f64).sqrt();
        // LFO peak at t = 1/16 s (full level), trough at 3/16 s (level × 0.2).
        let peak = rms(&out[2_400..3_600]);
        let trough = rms(&out[8_400..9_600]);
        assert!(trough < peak * 0.35, "peak {peak}, trough {trough}");
    }

    #[test]
    fn modulated_notes_render_the_same_in_blocks() {
        let modulation = Modulation {
            lfo_rate: 3.0,
            vibrato_cents: 20.0,
            lfo_cutoff_octaves: 1.0,
            tremolo: 0.3,
            filter_env_octaves: 2.0,
            filter_env_decay: 0.01,
        };
        for resonance in [0.0, 0.6] {
            assert_blocks_match_whole(&Voice {
                alpha: 0.3,
                cutoff: 1_200.0,
                resonance,
                modulation,
                ..voice(Oscillator::Supersaw)
            });
        }
    }

    #[test]
    fn notes_are_clipped_to_the_buffer() {
        let mut out = vec![0.0; 10];
        render_mono(&mut out, &voice(Oscillator::Triangle), -4, 8);
        assert!(out[..4].iter().all(|s| *s != 0.0));
        assert!(out[4..].iter().all(|s| *s == 0.0));

        let mut out = vec![0.0; 10];
        render_mono(&mut out, &voice(Oscillator::Triangle), 7, 100);
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
            Oscillator::Supersaw,
            Oscillator::PluckedString,
            Oscillator::FmBell,
            Oscillator::FmPiano,
            Oscillator::DrumKit,
            Oscillator::Bass808,
            Oscillator::Pulse25,
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
            assert_blocks_match_whole(&params);
        }
    }

    #[test]
    fn supersaw_stays_about_as_loud_as_one_saw() {
        let rms = |oscillator| {
            let mut out = vec![0.0; 48_000];
            render_mono(&mut out, &voice(oscillator), 0, 48_000);
            (out.iter().map(|s| s * s).sum::<f64>() / out.len() as f64).sqrt()
        };
        let ratio = rms(Oscillator::Supersaw) / rms(Oscillator::Sawtooth);
        assert!((0.6..1.2).contains(&ratio), "supersaw/saw RMS {ratio}");
    }

    #[test]
    fn plucked_string_is_in_tune_and_decays() {
        // Count rising zero crossings of a 660 Hz string over its second half-second (after the
        // noise has settled into a tone): close to 660 per second.
        let params = Voice {
            frequency: 660.0,
            ..voice(Oscillator::PluckedString)
        };
        let mut out = vec![0.0; 48_000];
        render_mono(&mut out, &params, 0, 48_000);
        let settled = &out[24_000..];
        let crossings = settled
            .windows(2)
            .filter(|w| w[0] < 0.0 && w[1] >= 0.0)
            .count();
        assert!(
            (325..=335).contains(&crossings),
            "{crossings} crossings in 0.5 s"
        );

        let peak = |range: &[f64]| range.iter().fold(0.0_f64, |max, s| max.max(s.abs()));
        assert!(
            peak(&out[40_000..]) < peak(&out[..4_800]) / 2.0,
            "the string should decay"
        );
    }

    #[test]
    fn plucked_string_noise_follows_the_seed() {
        let render = |seed| {
            let mut out = vec![0.0; 2_000];
            let params = Voice {
                seed,
                ..voice(Oscillator::PluckedString)
            };
            render_mono(&mut out, &params, 0, 2_000);
            out
        };
        assert_eq!(render(7), render(7));
        assert_ne!(render(7), render(8));
    }

    #[test]
    fn fm_gets_mellower_as_the_index_falls() {
        // Brightness as the share of sample-to-sample change (a rough high-frequency measure):
        // the start of an FM note must be brighter than its tail.
        for oscillator in [Oscillator::FmBell, Oscillator::FmPiano] {
            let mut out = vec![0.0; 48_000];
            render_mono(&mut out, &voice(oscillator), 0, 48_000);
            let brightness = |range: &[f64]| {
                let change: f64 = range.windows(2).map(|w| (w[1] - w[0]).abs()).sum();
                change / range.iter().map(|s| s.abs()).sum::<f64>()
            };
            let early = brightness(&out[..4_800]);
            let late = brightness(&out[43_200..]);
            assert!(
                early > late * 1.5,
                "{oscillator:?}: early {early}, late {late}"
            );
        }
    }

    fn midi_frequency(note: i32) -> f64 {
        440.0 * 2f64.powf((note - 69) as f64 / 12.0)
    }

    #[test]
    fn an_808_drops_onto_its_note_and_stays_in_range() {
        // Rising zero crossings per 0.1 s: well above the note at the start, at the note later.
        let params = Voice {
            frequency: 55.0,
            ..voice(Oscillator::Bass808)
        };
        let mut out = vec![0.0; 48_000];
        render_mono(&mut out, &params, 0, 48_000);
        let crossings = |range: &[f64]| {
            range
                .windows(2)
                .filter(|w| w[0] < 0.0 && w[1] >= 0.0)
                .count()
        };
        let early = crossings(&out[..4_800]);
        let late = crossings(&out[38_400..43_200]);
        assert!(early > late + 2, "early {early}, late {late}");
        assert!(
            (5..=6).contains(&late),
            "{late} crossings in 0.1 s at 55 Hz"
        );
        // Saturated but normalised: peaks reach 1 and never pass it.
        let peak = out.iter().fold(0.0_f64, |max, s| max.max(s.abs()));
        assert!(peak > 0.95 && peak <= 1.0, "peak {peak}");
    }

    #[test]
    fn a_25_percent_pulse_has_no_fourth_harmonic_and_no_offset() {
        // A 25% pulse's spectrum skips every fourth harmonic; that hollow, nasal gap is its
        // character. Measure harmonics 1 to 4 of 375 Hz (128 samples per cycle at 48 kHz).
        let params = Voice {
            frequency: 375.0,
            ..voice(Oscillator::Pulse25)
        };
        let mut out = vec![0.0; 48_000];
        render_mono(&mut out, &params, 0, 48_000);
        let harmonic = |k: f64| {
            let (mut re, mut im) = (0.0, 0.0);
            for (i, s) in out.iter().enumerate() {
                let angle = 2.0 * core::f64::consts::PI * k * 375.0 * i as f64 / 48_000.0;
                re += s * angle.cos();
                im += s * angle.sin();
            }
            (re * re + im * im).sqrt() / out.len() as f64
        };
        let (h1, h2, h3, h4) = (harmonic(1.0), harmonic(2.0), harmonic(3.0), harmonic(4.0));
        assert!(
            h4 < h1.min(h2).min(h3) / 50.0,
            "h1 {h1} h2 {h2} h3 {h3} h4 {h4}"
        );
        let mean = out.iter().sum::<f64>() / out.len() as f64;
        assert!(mean.abs() < 1e-3, "mean {mean}");
    }

    #[test]
    fn every_midi_note_is_recognised_from_its_frequency() {
        for note in 0..=127 {
            assert_eq!(midi_note(midi_frequency(note)), note);
        }
    }

    #[test]
    fn the_drum_map_follows_general_midi() {
        assert_eq!(DrumPiece::for_note(36), DrumPiece::Kick);
        assert_eq!(DrumPiece::for_note(38), DrumPiece::Snare);
        assert_eq!(DrumPiece::for_note(39), DrumPiece::Clap);
        assert_eq!(DrumPiece::for_note(42), DrumPiece::ClosedHat);
        assert_eq!(DrumPiece::for_note(46), DrumPiece::OpenHat);
        assert_eq!(DrumPiece::for_note(49), DrumPiece::Crash);
        assert_eq!(DrumPiece::for_note(45), DrumPiece::Tom);
    }

    fn drum_hit(note: i32) -> Vec<f64> {
        let params = Voice {
            frequency: midi_frequency(note),
            ..voice(Oscillator::DrumKit)
        };
        let mut out = vec![0.0; 24_000];
        render_mono(&mut out, &params, 0, 24_000);
        out
    }

    /// Share of sample-to-sample change: high for hats, low for a kick.
    fn brightness(samples: &[f64]) -> f64 {
        let change: f64 = samples.windows(2).map(|w| (w[1] - w[0]).abs()).sum();
        change / samples.iter().map(|s| s.abs()).sum::<f64>()
    }

    fn energy(samples: &[f64]) -> f64 {
        samples.iter().map(|s| s * s).sum()
    }

    #[test]
    fn drums_sound_like_their_kind() {
        let (kick, snare, hat, open_hat) = (drum_hit(36), drum_hit(38), drum_hit(42), drum_hit(46));
        // A kick is a low thump; hats are bright noise; a snare sits between.
        assert!(brightness(&kick) < brightness(&snare));
        assert!(brightness(&snare) < brightness(&hat));
        // A closed hat is short, an open hat rings: compare what's left after 0.1 s.
        let tail = |s: &[f64]| energy(&s[4_800..]) / energy(s);
        assert!(tail(&hat) < tail(&open_hat) / 5.0);
        // Every hit is audible and starts near its peak.
        for hit in [&kick, &snare, &hat, &open_hat] {
            assert!(energy(&hit[..2_400]) > energy(&hit[12_000..]));
        }
    }

    #[test]
    fn noise_drums_follow_the_seed() {
        let hit = |seed| {
            let params = Voice {
                frequency: midi_frequency(38),
                seed,
                ..voice(Oscillator::DrumKit)
            };
            let mut out = vec![0.0; 2_000];
            render_mono(&mut out, &params, 0, 2_000);
            out
        };
        assert_eq!(hit(3), hit(3));
        assert_ne!(hit(3), hit(4));
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
        render_mono(&mut once, &voice(Oscillator::Triangle), 0, 64);
        let mut twice = once.clone();
        render_mono(&mut twice, &voice(Oscillator::Triangle), 0, 64);
        for (a, b) in once.iter().zip(&twice) {
            assert_eq!(*b, a + a);
        }
    }
}
