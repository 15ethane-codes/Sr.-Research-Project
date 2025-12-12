const LR_coefs = [1.60056473, -0.34815377, 2.17577448];
const LR_intercept = 0.13098922;

const scaler_mean = [1.68615930e+03, 5.56984575e-01, 2.37000000e+01];
const scaler_std = [1.57191307e+03, 5.18929288e-01, 1.31061054e+01];

function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

function scale(feature, mean, std){
    return (feature - mean) / std;
}

function predictDoomscroll(features) {
    const x = [
        scale(features.scrollIntensity, scaler_mean[0], scaler_std[0]),
        scale(features.engagementScore, scaler_mean[1], scaler_std[1]),
        scale(features.duration, scaler_mean[2], scaler_std[2])
    ];
    let z = LR_intercept;
    for (let i = 0; i < LR_coefs.length; i++) {
        z += LR_coefs[i] * x[i];
    }
    const probability = sigmoid(z);
    return probability;
}
window.predictDoomscroll = predictDoomscroll;