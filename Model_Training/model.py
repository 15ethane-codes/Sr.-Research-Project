import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score
import matplotlib.pyplot as plt
import seaborn as sns
import os


# Get current working directory
cwd = os.getcwd()
print("Current working directory:", cwd)

# Build path to your CSV file
file_path = os.path.join(cwd, "Model_Training", "session_data.csv")
print("Full path to CSV:", file_path)

if os.path.isfile(file_path):
    print("File found! Loading now...")
    df = pd.read_csv(file_path)
    print("CSV loaded successfully.")
else:
    print("File not found. Check the filename and folder.")

# To track
print("Loading dataset...")
df = pd.read_csv(file_path) 

print(f"Total Sessions: {len(df)}")
print("\nData preview:")
print(df.head())

#Stats
print(df.describe())
print(df.isnull().sum())

#Engineer Features
df['Scroll Intensity (px/min)'] = df['Total Scroll Distance'] / df['Duration (minutes)']
df['Click Rate (clicks/min)'] = df['Total Clicks'] / df['Duration (minutes)']
df['Scroll per Click'] = df['Total Scroll Distance'] / df['Total Clicks'].replace(0,1)
df['Avg Scroll Speed (px/event)'] = df['Total Scroll Distance'] / df['Scroll Events Count'].replace(0,1)
df['Engagement Score'] = df.apply(
    lambda row: (row['Total Clicks'] * 1000 / row['Total Scroll Distance']) if row['Total Scroll Distance'] > 0 else 0,
    axis=1
)

# Select features for ML
feature_columns = [
    'Duration (minutes)',
    'Total Scroll Distance',
    'Total Clicks',
    'Scroll Events Count',
    'Scroll Intensity (px/min)',   # scroll distance / duration
    'Click Rate (clicks/min)',     # clicks / duration
    'Scroll per Click',            # scroll events / clicks
    'Avg Scroll Speed (px/event)', # scroll distance / scroll events
    'Engagement Score'             # clicks * 1000 / scroll distance
]


X = df[feature_columns]

df['is_doomscrolling'] = (
    (df['Duration (minutes)'] > 15) & 
    (df['Engagement Score'] < 0.5) & 
    (df['Scroll Intensity (px/min)'] > 1000)
).astype(int)

y = df['is_doomscrolling']

print(f"\nDoomscrolling sessions: {y.sum()} ({y.sum()/len(y)*100:.1f}%)")
print(f"Focused sessions: {len(y)-y.sum()} ({(len(y)-y.sum())/len(y)*100:.1f}%)")

# Check if we have enough data (P.s: I don't)

# Split data
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

print(f"\nTraining set: {len(X_train)} sessions")
print(f"Test set: {len(X_test)} sessions")

#Training
lr_model = LogisticRegression(random_state=42, max_iter=1000)
lr_model.fit(X_train_scaled, y_train)

lr_pred = lr_model.predict(X_test_scaled)
lr_pred_proba = lr_model.predict_proba(X_test_scaled)[:, 1]

print("\nLogistic Regression Results:")
print(classification_report(y_test, lr_pred, target_names=['Focused', 'Doomscrolling']))
print(f"ROC-AUC Score: {roc_auc_score(y_test, lr_pred_proba):.3f}")

cv_scores = cross_val_score(lr_model, X_train_scaled, y_train, cv=5)
print(f"Cross-validation accuracy: {cv_scores.mean():.3f} (+/- {cv_scores.std():.3f})")

#Random Forest
rf_model = RandomForestClassifier(n_estimators=100, random_state=42)
rf_model.fit(X_train_scaled, y_train)

rf_pred = rf_model.predict(X_test_scaled)
rf_pred_proba = rf_model.predict_proba(X_test_scaled)[:, 1]

print("\nRandom Forest Results:")
print(classification_report(y_test, rf_pred, target_names=['Focused', 'Doomscrolling']))
print(f"ROC-AUC Score: {roc_auc_score(y_test, rf_pred_proba):.3f}")

feature_importance = pd.DataFrame({
    'feature': feature_columns,
    'importance': rf_model.feature_importances_
}).sort_values('importance', ascending=False)

print(feature_importance)

#Visualization
plt.figure(figsize=(10, 6))
sns.barplot(x='importance', y='feature', data=feature_importance)
