import pandas as pd
import numpy as np
from sklearn.model_selection import KFold, LeaveOneOut
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix, roc_curve, auc, roc_auc_score, classification_report
import matplotlib.pyplot as plt
import seaborn as sns
import os
from scipy.stats import ttest_ind

# 1. Load Dataset
cwd = os.getcwd()
file_path = os.path.join(cwd, "Model_Training", "session_data.csv")

if not os.path.isfile(file_path):
    raise FileNotFoundError(f"CSV file not found at {file_path}")

df = pd.read_csv(file_path)
print(f"Total sessions: {len(df)}")

# 2. Feature Engineering
df['Scroll Intensity (px/min)'] = df['Total Scroll Distance'] / df['Duration (minutes)']
df['Click Rate (clicks/min)'] = df['Total Clicks'] / df['Duration (minutes)']
df['Scroll per Click'] = df['Total Scroll Distance'] / df['Total Clicks'].replace(0,1)
df['Avg Scroll Speed (px/event)'] = df['Total Scroll Distance'] / df['Scroll Events Count'].replace(0,1)
df['Engagement Score'] = df.apply(
    lambda row: (row['Total Clicks'] * 1000 / row['Total Scroll Distance']) if row['Total Scroll Distance'] > 0 else 0,
    axis=1
)

# 3. Use Pre-Labeled Column
df['is_doomscrolling'] = df['doomscroll_label']
y = df['is_doomscrolling']

print(f"Doomscrolling sessions: {y.sum()} ({y.sum()/len(y)*100:.1f}%)")
print(f"Focused sessions: {len(y)-y.sum()} ({(len(y)-y.sum())/len(y)*100:.1f}%)")

# 4. Select Top Features Only
top_features = ['Scroll Intensity (px/min)', 'Engagement Score', 'Duration (minutes)']
X = df[top_features]

# Print Feature Summary (mean/std per label)
summary = {}
for feature in top_features:
    summary[feature] = {
        'overall_mean': df[feature].mean(),
        'overall_std': df[feature].std(),
        'focused_mean': df[df['is_doomscrolling']==0][feature].mean(),
        'doom_mean': df[df['is_doomscrolling']==1][feature].mean(),
        'focused_std': df[df['is_doomscrolling']==0][feature].std(),
        'doom_std': df[df['is_doomscrolling']==1][feature].std()
    }
summary_df = pd.DataFrame(summary).T
print("\nFeature Summary (mean/std per label):")
print(summary_df)

# Print feature importance using Random Forest
rf_model = RandomForestClassifier(n_estimators=100, random_state=42)
rf_model.fit(X, y)
importance_df = pd.DataFrame({
    'feature': X.columns,
    'importance': rf_model.feature_importances_
}).sort_values('importance', ascending=False)
print("\nFeature Importance (Random Forest):")
print(importance_df)

# 5. Scale Features
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# 6. Define Models
lr_model = LogisticRegression(max_iter=1000, random_state=42)


# --- FIXED: Safe cross-validation function ---
def cross_val_metrics(model, X, y, cv):
    cms, tprs, aucs = [], [], []
    mean_fpr = np.linspace(0, 1, 100)

    for train_idx, test_idx in cv.split(X, y):
        X_train, X_test = X[train_idx], X[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)

        # SAFE CM: always 0 and 1 labels
        cm = confusion_matrix(y_test, y_pred, labels=[0, 1])
        cms.append(cm)

        # skip ROC if test set has one class
        if len(np.unique(y_test)) < 2:
            continue

        y_proba = model.predict_proba(X_test)[:, 1]
        fpr, tpr, _ = roc_curve(y_test, y_proba)
        aucs.append(auc(fpr, tpr))

        tpr_interp = np.interp(mean_fpr, fpr, tpr)
        tpr_interp[0] = 0.0
        tprs.append(tpr_interp)

    mean_cm = np.mean(cms, axis=0)
    mean_tpr = np.mean(tprs, axis=0) if tprs else np.zeros_like(mean_fpr)
    if tprs:
        mean_tpr[-1] = 1.0
    mean_auc = np.mean(aucs) if aucs else float('nan')

    return mean_cm, mean_fpr, mean_tpr, mean_auc


# 8. Run 5-Fold CV
kf = KFold(n_splits=5, shuffle=True, random_state=42)

rf_cm_5, rf_fpr_5, rf_tpr_5, rf_auc_5 = cross_val_metrics(rf_model, X_scaled, y, kf)
lr_cm_5, lr_fpr_5, lr_tpr_5, lr_auc_5 = cross_val_metrics(lr_model, X_scaled, y, kf)

print(f"\nRandom Forest 5-Fold AUC: {rf_auc_5:.3f}")
print(f"Logistic Regression 5-Fold AUC: {lr_auc_5:.3f}")

# 9. Plot Confusion Matrix
def plot_cm(cm, title):
    plt.figure(figsize=(5,4))
    sns.heatmap(cm, annot=True, fmt=".1f", cmap='Blues',
                xticklabels=['Focused','Doomscrolling'],
                yticklabels=['Focused','Doomscrolling'])
    plt.xlabel("Predicted")
    plt.ylabel("Actual")
    plt.title(title)
    plt.show()

plot_cm(rf_cm_5, "Random Forest 5-Fold CV")
plot_cm(lr_cm_5, "Logistic Regression 5-Fold CV")

# 10. Plot ROC Curve
def plot_roc(fpr, tpr, auc_score, title):
    plt.figure(figsize=(6,5))
    plt.plot(fpr, tpr, label=f'AUC={auc_score:.3f}')
    plt.plot([0,1],[0,1],'k--')
    plt.xlabel('False Positive Rate')
    plt.ylabel('True Positive Rate')
    plt.title(title)
    plt.legend()
    plt.show()

plot_roc(rf_fpr_5, rf_tpr_5, rf_auc_5, "Random Forest 5-Fold ROC")
plot_roc(lr_fpr_5, lr_tpr_5, lr_auc_5, "Logistic Regression 5-Fold ROC")


# --- FIXED: LOOCV that handles single-class safely ---
def loo_metrics(model, X_scaled, y):
    y_true, y_pred, y_proba = [], [], []

    for train_idx, test_idx in LeaveOneOut().split(X_scaled, y):
        X_train, X_test = X_scaled[train_idx], X_scaled[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]

        model.fit(X_train, y_train)
        pred = model.predict(X_test)
        proba = model.predict_proba(X_test)[:, 1]

        y_true.append(y_test.values[0])
        y_pred.append(pred[0])
        y_proba.append(proba[0])

    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])

    # ROC requires both classes
    if len(np.unique(y_true)) < 2:
        return cm, np.array([0,1]), np.array([0,1]), float('nan')

    fpr, tpr, _ = roc_curve(y_true, y_proba)
    roc_auc = auc(fpr, tpr)
    return cm, fpr, tpr, roc_auc


# 11. Run LOOCV
rf_cm_loo, rf_fpr_loo, rf_tpr_loo, rf_auc_loo = loo_metrics(rf_model, X_scaled, y)
lr_cm_loo, lr_fpr_loo, lr_tpr_loo, lr_auc_loo = loo_metrics(lr_model, X_scaled, y)

print(f"\nRandom Forest LOOCV AUC: {rf_auc_loo:.3f}")
print(f"Logistic Regression LOOCV AUC: {lr_auc_loo:.3f}")

plot_cm(rf_cm_loo, "Random Forest LOOCV")
plot_roc(rf_fpr_loo, rf_tpr_loo, rf_auc_loo, "Random Forest LOOCV ROC")

plot_cm(lr_cm_loo, "Logistic Regression LOOCV")
plot_roc(lr_fpr_loo, lr_tpr_loo, lr_auc_loo, "Logistic Regression LOOCV ROC")

# 12. T-tests & Cohen's d for hypothesis testing
def cohen_d(x1, x2):
    """Compute Cohen's d for two independent samples."""
    n1, n2 = len(x1), len(x2)
    s1, s2 = np.var(x1, ddof=1), np.var(x2, ddof=1)
    pooled_std = np.sqrt(((n1-1)*s1 + (n2-1)*s2) / (n1 + n2 - 2))
    return (np.mean(x1) - np.mean(x2)) / pooled_std

print("\n--- T-tests and Cohen's d ---")
for feature in top_features:
    focused_vals = df[df['is_doomscrolling']==0][feature]
    doom_vals = df[df['is_doomscrolling']==1][feature]
    
    t_stat, p_val = ttest_ind(focused_vals, doom_vals, equal_var=False)
    d_val = cohen_d(focused_vals, doom_vals)
    
    print(f"\nFeature: {feature}")
    print(f"  Focused mean: {focused_vals.mean():.3f}, Doom mean: {doom_vals.mean():.3f}")
    print(f"  t-statistic: {t_stat:.3f}, p-value: {p_val:.4f}")
    print(f"  Cohen's d: {d_val:.3f}")

