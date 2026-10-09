//! The synthesis kernel as a plain WebAssembly module: numbers in, samples in linear memory out,
//! no JavaScript glue. That lets the same file load in Node (the render worker) and in an
//! AudioWorklet (the studio preview), where generated bindings can't run.
//! The TypeScript side is `packages/dsp-kernel`.

use std::cell::RefCell;

use synaptix_dsp::voice::{self, Oscillator, Voice};

thread_local! {
    static TRACK: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
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
    note_start: f64,
    note_total: f64,
) -> u32 {
    let Some(oscillator) = Oscillator::from_code(oscillator) else {
        return 0;
    };
    let params = Voice {
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
    };
    TRACK.with_borrow_mut(|track| {
        voice::render_voice(track, &params, note_start as i64, note_total as i64)
    });
    1
}
