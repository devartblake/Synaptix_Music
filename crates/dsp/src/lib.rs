pub fn gain(input: &[f32], amount: f32) -> Vec<f32> {
    input.iter().map(|sample| sample * amount).collect()
}

#[cfg(test)]
mod tests {
    use super::gain;

    #[test]
    fn applies_gain_to_each_sample() {
        let output = gain(&[0.25, -0.5, 1.0], 2.0);

        assert_eq!(output, vec![0.5, -1.0, 2.0]);
    }
}
