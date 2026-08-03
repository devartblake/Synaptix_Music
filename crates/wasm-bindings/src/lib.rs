use wasm_bindgen::prelude::*;
#[wasm_bindgen]
pub fn apply_gain(input: Vec<f32>, amount: f32) -> Vec<f32> { synaptix_dsp::gain(&input, amount) }
