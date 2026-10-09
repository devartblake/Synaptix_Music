//! The synthesis kernel as a plain WebAssembly module: numbers in, samples in linear memory out,
//! no JavaScript glue. That lets the same file load in Node (the render worker) and in an
//! AudioWorklet (the studio preview), where generated bindings can't run.
//! The TypeScript side is `packages/dsp-kernel`.

use std::cell::RefCell;

use synaptix_dsp::voice::{self, Modulation, Oscillator, Voice, VoiceState};

thread_local! {
    static TRACK: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    // Real-time playback (the studio preview's AudioWorklet): the sounding notes, and the
    // block they mix into.
    static VOICES: RefCell<Vec<VoiceState>> = const { RefCell::new(Vec::new()) };
    static MIX: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static BLOCK: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}

/// Starts a track: a zeroed stereo buffer, `len` left samples then `len` right samples, that
/// `render_voice` adds into. Returns its address; read it after the last voice (memory may grow
/// on the next call here).
#[no_mangle]
pub extern "C" fn begin_track(len: u32) -> *const f64 {
    TRACK.with_borrow_mut(|track| {
        track.clear();
        track.resize(2 * len as usize, 0.0);
        track.as_ptr()
    })
}

/// Adds one note to the current track. Sample positions are whole numbers passed as `f64`
/// (JavaScript numbers); the last six arguments are the voice's `Modulation` (all zero for
/// none). Returns 0 for an unknown oscillator code, 1 otherwise.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn render_voice(
    oscillator: u32,
    frequency: f64,
    sample_rate: f64,
    alpha: f64,
    attack: f64,
    decay: f64,
    sustain: f64,
    release: f64,
    note_duration: f64,
    velocity_gain: f64,
    seed: u32,
    cutoff: f64,
    resonance: f64,
    lfo_rate: f64,
    vibrato_cents: f64,
    lfo_cutoff_octaves: f64,
    tremolo: f64,
    filter_env_octaves: f64,
    filter_env_decay: f64,
    note_start: f64,
    note_total: f64,
) -> u32 {
    let Some(params) = voice_params(
        oscillator,
        frequency,
        sample_rate,
        alpha,
        attack,
        decay,
        sustain,
        release,
        note_duration,
        velocity_gain,
        seed,
        cutoff,
        resonance,
        Modulation {
            lfo_rate,
            vibrato_cents,
            lfo_cutoff_octaves,
            tremolo,
            filter_env_octaves,
            filter_env_decay,
        },
    ) else {
        return 0;
    };
    TRACK.with_borrow_mut(|track| {
        let half = track.len() / 2;
        let (left, right) = track.split_at_mut(half);
        voice::render_voice(left, right, &params, note_start as i64, note_total as i64)
    });
    1
}

/// Starts a note for real-time playback at frame `start` (an `f64` whole number), lasting
/// `total` frames. Same parameters and return value as `render_voice`.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn start_voice(
    oscillator: u32,
    frequency: f64,
    sample_rate: f64,
    alpha: f64,
    attack: f64,
    decay: f64,
    sustain: f64,
    release: f64,
    note_duration: f64,
    velocity_gain: f64,
    seed: u32,
    cutoff: f64,
    resonance: f64,
    lfo_rate: f64,
    vibrato_cents: f64,
    lfo_cutoff_octaves: f64,
    tremolo: f64,
    filter_env_octaves: f64,
    filter_env_decay: f64,
    start: f64,
    total: f64,
) -> u32 {
    let Some(params) = voice_params(
        oscillator,
        frequency,
        sample_rate,
        alpha,
        attack,
        decay,
        sustain,
        release,
        note_duration,
        velocity_gain,
        seed,
        cutoff,
        resonance,
        Modulation {
            lfo_rate,
            vibrato_cents,
            lfo_cutoff_octaves,
            tremolo,
            filter_env_octaves,
            filter_env_decay,
        },
    ) else {
        return 0;
    };
    VOICES
        .with_borrow_mut(|voices| voices.push(VoiceState::new(params, start as i64, total as i64)));
    1
}

/// Note off for every sounding note at `frame`; notes not yet started are dropped.
#[no_mangle]
pub extern "C" fn release_voices(frame: f64) {
    VOICES.with_borrow_mut(|voices| {
        for voice in voices.iter_mut() {
            voice.release_at(frame as i64);
        }
        voices.retain(|voice| !voice.finished());
    });
}

/// Mixes every sounding note into frames `block_start .. block_start + len` and returns the
/// address of `len` left then `len` right `f32` samples. Finished notes are dropped.
#[no_mangle]
pub extern "C" fn render_block(block_start: f64, len: u32) -> *const f32 {
    let len = len as usize;
    MIX.with_borrow_mut(|mix| {
        mix.clear();
        mix.resize(2 * len, 0.0);
        let (left, right) = mix.split_at_mut(len);
        VOICES.with_borrow_mut(|voices| {
            for voice in voices.iter_mut() {
                voice.render(left, right, block_start as i64);
            }
            voices.retain(|voice| !voice.finished());
        });
        BLOCK.with_borrow_mut(|block| {
            block.clear();
            block.extend(mix.iter().map(|sample| *sample as f32));
            block.as_ptr()
        })
    })
}

#[allow(clippy::too_many_arguments)]
fn voice_params(
    oscillator: u32,
    frequency: f64,
    sample_rate: f64,
    alpha: f64,
    attack: f64,
    decay: f64,
    sustain: f64,
    release: f64,
    note_duration: f64,
    velocity_gain: f64,
    seed: u32,
    cutoff: f64,
    resonance: f64,
    modulation: Modulation,
) -> Option<Voice> {
    Some(Voice {
        oscillator: Oscillator::from_code(oscillator)?,
        frequency,
        sample_rate,
        alpha,
        attack,
        decay,
        sustain,
        release,
        note_duration,
        velocity_gain,
        seed,
        cutoff,
        resonance,
        modulation,
    })
}
