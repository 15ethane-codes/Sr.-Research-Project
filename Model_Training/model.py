import pandas as pd
import numpy as np
from sklearn.model_selection import KFold, LeaveOneOut
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import confusion_matrix, roc_curve, auc
import matplotlib.pyplot as plt
import seaborn as sns
import os

# --- 1. Load Dataset ---
cwd = os.getcwd()
file_path = os.path.join(cwd, "Model_Training", "session_data.csv")
if not os.path.isfile(file_path):
    raise FileNotFoundError(f"CSV file not found at {file_path}")

df = pd.read_csv(file_path)

# --- 2. Feature Engineering ---
df['Scroll Intensity (px/min)'] = df['Total Scroll Distance'] / df['Duration (minutes)']
df['Click Rate (clicks/min)'] = df['Total Clicks'] / df['Duration (minutes)']
df['Scroll per Click'] = df['Total Scroll Distance'] / df['Total Clicks'].replace(0,1)
df['Avg Scroll Speed (px/event)'] = df['Total Scroll Distance'] / df['Scroll Events Count'].replace(0,1)
df['Engagement Score'] = df.apply(
    lambda row: (row['Total Clicks'] * 1000 / row['Total Scroll Distance']) if row['Total Scroll Distance'] > 0 else 0,
    axis=1
)

feature_columns = [
    'Duration (minutes)',
    'Total Scroll Distance',
    'Total Clicks',
    'Scroll Events Count',
    'Scroll Intensity (px/min)',
    'Click Rate (clicks/min)',
    'Scroll per Click',
    'Avg Scroll Speed (px/event)',
    'Engagement Score'
]

X = df[feature_columns]

# --- 3. Labels ---
df['is_doomscrolling'] = df['doomscroll_label']
y = df['is_doomscrolling']

print(f"Doomscrolling sessions: {y.sum()} ({y.sum()/len(y)*100:.1f}%)")
print(f"Focused sessions: {len(y)-y.sum()} ({(len(y)-y.sum())/len(y)*100:.1f}%)")

# --- 4. Scale Features ---
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)
X_scaled_df = pd.DataFrame(X_scaled, columns=feature_columns)

# --- 5. Feature Importance ---
def feature_importance_rank(X, y):
    rf = RandomForestClassifier(n_estimators=100, random_state=42)
    rf.fit(X, y)
    importance_df = pd.DataFrame({
        'feature': X.columns,
        'importance': rf.feature_importances_
    }).sort_values('importance', ascending=False)
    return importance_df

importance_df = feature_importance_rank(X_scaled_df, y)
print("Feature Importance:\n", importance_df)

plt.figure(figsize=(10,6))
sns.barplot(x='importance', y='feature', data=importance_df)
plt.title("Random Forest Feature Importance")
plt.tight_layout()
plt.show()

# --- 6. Automated Feature Analysis ---
def feature_summary(df, features, label='is_doomscrolling'):
    summary = {}
    for feature in features:
        summary[feature] = {
            'overall_mean': df[feature].mean(),
            'overall_std': df[feature].std(),
            'focused_mean': df[df[label]==0][feature].mean(),
            'doom_mean': df[df[label]==1][feature].mean(),
            'focused_std': df[df[label]==0][feature].std(),
            'doom_std': df[df[label]==1][feature].std()
        }
    return pd.DataFrame(summary).T

summary_df = feature_summary(df, feature_columns)
print("Feature Summary:\n", summary_df)

# Correlation filter
def feature_correlation_filter(df, features, threshold=0.9):
    corr_matrix = df[features].corr().abs()
    to_drop = [col for col in corr_matrix.columns if any(corr_matrix[col] > threshold) and col not in corr_matrix.columns[:1]]
    return to_drop

to_drop = feature_correlation_filter(df, feature_columns)
print("Highly correlated features to drop:", to_drop)

# Drop correlated features
X_filtered = X_scaled_df.drop(columns=to_drop)
feature_columns_filtered = X_filtered.columns.tolist()

# --- 7. Cross-Validation Functions ---
def cross_val_confusion_roc(model, X, y, cv):
    cms, tprs, aucs = [], [], []
    mean_fpr = np.linspace(0,1,100)
    for train_idx, test_idx in cv.split(X, y):
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)
        y_proba = model.predict_proba(X_test)[:,1]
        cms.append(confusion_matrix(y_test, y_pred))
        fpr, tpr, _ = roc_curve(y_test, y_proba)
        tpr_interp = np.interp(mean_fpr, fpr, tpr)
        tpr_interp[0] = 0.0
        tprs.append(tpr_interp)
        aucs.append(auc(fpr, tpr))
    mean_cm = np.mean(cms, axis=0)
    mean_tpr = np.mean(tprs, axis=0)
    mean_tpr[-1] = 1.0
    mean_auc = np.mean(aucs)
    return mean_cm, mean_fpr, mean_tpr, mean_auc

# --- 8. Train & Evaluate Models ---
lr_model = LogisticRegression(random_state=42, max_iter=1000)
rf_model = RandomForestClassifier(n_estimators=100, random_state=42)

# 5-Fold CV
kf = KFold(n_splits=5, shuffle=True, random_state=42)
rf_cm_5fold, rf_fpr_5, rf_tpr_5, rf_auc_5 = cross_val_confusion_roc(rf_model, X_filtered, y, kf)
lr_cm_5fold, lr_fpr_5, lr_tpr_5, lr_auc_5 = cross_val_confusion_roc(lr_model, X_filtered, y, kf)

print("Random Forest 5-Fold AUC:", rf_auc_5)
print("Logistic Regression 5-Fold AUC:", lr_auc_5)

# LOOCV
from sklearn.model_selection import LeaveOneOut
loo = LeaveOneOut()
def loo_eval(model, X, y):
    y_true, y_pred, y_proba = [], [], []
    for train_idx, test_idx in loo.split(X, y):
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
        model.fit(X_train, y_train)
        pred = model.predict(X_test)
        proba = model.predict_proba(X_test)[:,1]
        y_true.append(y_test.values[0])
        y_pred.append(pred[0])
        y_proba.append(proba[0])
    cm = confusion_matrix(y_true, y_pred)
    fpr, tpr, _ = roc_curve(y_true, y_proba)
    roc_auc = auc(fpr, tpr)
    return cm, fpr, tpr, roc_auc

rf_loo_cm, rf_loo_fpr, rf_loo_tpr, rf_loo_auc = loo_eval(rf_model, X_filtered, y)
lr_loo_cm, lr_loo_fpr, lr_loo_tpr, lr_loo_auc = loo_eval(lr_model, X_filtered, y)

print("Random Forest LOOCV AUC:", rf_loo_auc)
print("Logistic Regression LOOCV AUC:", lr_loo_auc)
