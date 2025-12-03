import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score, LeaveOneOut, KFold
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report, roc_auc_score
import matplotlib.pyplot as plt
import seaborn as sns
import os


cwd = os.getcwd()
file_path = os.path.join(cwd, "Model_Training", "session_data.csv")
df = pd.read_csv(file_path)

print("Dataset loaded:", len(df), "sessions")
print(df.head())

# Feature Engineering

df['Scroll Intensity (px/min)'] = df['Total Scroll Distance'] / df['Duration (minutes)']
df['Click Rate (clicks/min)'] = df['Total Clicks'] / df['Duration (minutes)']
df['Scroll per Click'] = df['Total Scroll Distance'] / df['Total Clicks'].replace(0, 1)
df['Avg Scroll Speed (px/event)'] = df['Total Scroll Distance'] / df['Scroll Events Count'].replace(0, 1)

df['Engagement Score'] = df.apply(
    lambda row: (row['Total Clicks'] * 1000 / row['Total Scroll Distance']) 
                if row['Total Scroll Distance'] > 0 else 0,
    axis=1
)


df['is_doomscrolling'] = (
    (df['Duration (minutes)'] > 15) &
    (df['Engagement Score'] < 0.5) &
    (df['Scroll Intensity (px/min)'] > 1000)
).astype(int)

y = df['is_doomscrolling']

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

print("\nLabel distribution:")
print(y.value_counts(normalize=True))

#Training
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

# Logistic Regression Pipeline
lr_pipeline = Pipeline([
    ("scaler", StandardScaler()),
    ("lr", LogisticRegression(max_iter=1000))
])

lr_pipeline.fit(X_train, y_train)
lr_pred = lr_pipeline.predict(X_test)
lr_proba = lr_pipeline.predict_proba(X_test)[:, 1]

print("\n=== Logistic Regression Test Results ===")
print(classification_report(y_test, lr_pred))
print("ROC-AUC:", roc_auc_score(y_test, lr_proba))

# Cross-validation
lr_cv = cross_val_score(lr_pipeline, X, y, cv=5)
print("\nLR 5-Fold Accuracy:", lr_cv.mean(), lr_cv.std())

rf_pipeline = Pipeline([
    ("scaler", StandardScaler()),
    ("rf", RandomForestClassifier(n_estimators=200, random_state=42))
])

# Random Forest Training and Evaluation
rf_pipeline.fit(X_train, y_train)
rf_pred = rf_pipeline.predict(X_test)
rf_proba = rf_pipeline.predict_proba(X_test)[:, 1]

print("\n Random Forest Test Results")
print(classification_report(y_test, rf_pred))
print("ROC-AUC:", roc_auc_score(y_test, rf_proba))

rf_cv = cross_val_score(rf_pipeline, X, y, cv=5)
print("\nRF 5-Fold Accuracy:", rf_cv.mean(), rf_cv.std())

# K-Fold Comparison (RF)
kfold = KFold(n_splits=5, shuffle=True, random_state=42)
kfold_scores = cross_val_score(rf_pipeline, X, y, cv=kfold)
print("\nK-Fold RF:", kfold_scores, "Mean:", kfold_scores.mean())

# LOOCV (RF)
loo = LeaveOneOut()
loo_scores = cross_val_score(rf_pipeline, X, y, cv=loo)
print("\nLOOCV RF Mean:", loo_scores.mean())

rf_pipeline.fit(X, y)
rf_model = rf_pipeline.named_steps["rf"]

importances = rf_model.feature_importances_
feature_importance = pd.DataFrame({
    "Feature": feature_columns,
    "Importance": importances
}).sort_values("Importance", ascending=False)

print("\nFeature importance:")
print(feature_importance)

plt.figure(figsize=(8, 5))
sns.barplot(data=feature_importance, x="Importance", y="Feature")
plt.title("Feature Importance (Random Forest)")
plt.tight_layout()
plt.show()