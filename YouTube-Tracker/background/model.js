const scaler = {
  mean: [1686.1593, 0.5569846, 23.7],
  std:  [1571.9131, 0.5189293, 13.1061054]
};

const lrModel = {
  weights: [1.60056473, -0.34815377, 2.17577448],
  bias: 0.13098922
};

function standardize(x, i) {
  return (x - scaler.mean[i]) / scaler.std[i];
}

function sigmoid(z) {
  return 1 / (1 + Math.exp(-z));
}

function predictDoomscrollProbability(features) {
  const x = [
    features.scrollIntensity,
    features.engagementScore,
    features.durationMinutes
  ];

  let z = lrModel.bias;

  for (let i = 0; i < x.length; i++) {
    z += lrModel.weights[i] * standardize(x[i], i);
  }

  return sigmoid(z); // probability of doomscrolling (test run)
}