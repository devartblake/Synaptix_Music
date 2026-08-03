pub fn gain(input: &[f32], amount: f32) -> Vec<f32> { input.iter().map(|sample| sample * amount).collect() }
