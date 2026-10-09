//! The synthesis kernel as a plain WebAssembly module: numbers in, samples in linear memory out,
//! no JavaScript glue. That lets the same file load in Node (the render worker) and in an
//! AudioWorklet (the studio preview), where generated bindings can't run.
//! The TypeScript side is `packages/dsp-kernel`.

use std::cell::RefCell;

use synaptix_dsp::voice::{self, Oscillator, Voice, VoiceState};

thread_local! {
    static TRACK: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    // Real-time playback (the studio preview's AudioWorklet): the sounding notes, and the
    // block they mix into.
    static VOICES: RefCell<Vec<VoiceState>> = const { RefCell::new(Vec::new()) };
    static MIX: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static BLOCK: RefCell<Vec<f32>> = const { RefCell::new(Vec::new()) };
}

/// Starts a track: a zeroed mono buffer of `len` samples that `render_voice` adds into.
/// Returns its address; read it after the last voice (memory may grow on the next call here).
#[no_mangle]
pub extern "C" fn begin_track(len: u32) -> *const f64 {
    TRACK.with_borrow_mut(|track| {
        track.clear();
        track.resize(len as usize, 0.0);
        track.as_ptr()
    })
}

/// Adds one note to the current track. Sample positions are whole numbers passed as `f64`
/// (JavaScript numbers). Returns 0 for an unknown oscillator code, 1 otherwise.
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
    ) else {
        return 0;
    };
    TRACK.with_borrow_mut(|track| {
        voice::render_voice(track, &params, note_start as i64, note_total as i64)
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
/// address of `len` `f32` samples. Finished notes are dropped.
#[no_mangle]
pub extern "C" fn render_block(block_start: f64, len: u32) -> *const f32 {
    let len = len as usize;
    MIX.with_borrow_mut(|mix| {
        mix.clear();
        mix.resize(len, 0.0);
        VOICES.with_borrow_mut(|voices| {
            for voice in voices.iter_mut() {
                voice.render(mix, block_start as i64);
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
    })
}
