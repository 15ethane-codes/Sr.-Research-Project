import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, KFold, LeaveOneOut
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix, roc_curve, auc
import matplotlib.pyplot as plt
import seaborn as sns
import os

# 1. Load Dataset
cwd = os.getcwd()
file_path = os.path.join(cwd, "Model_Training", "session_data.csv")

if not os.path.isfile(file_path):
    raise FileNotFoundError(f"CSV file not found at {file_path}")

df = pd.read_csv(file_path)
print(f"Total sessions: {len(df)}")
print(df.head())

# 2. Feature Engineering
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

# Label: Doomscrolling
df['is_doomscrolling'] = (
    (df['Duration (minutes)'] > 15) & 
    (df['Engagement Score'] < 0.5) & 
    (df['Scroll Intensity (px/min)'] > 1000)
).astype(int)
y = df['is_doomscrolling']

print(f"Doomscrolling sessions: {y.sum()} ({y.sum()/len(y)*100:.1f}%)")
print(f"Focused sessions: {len(y)-y.sum()} ({(len(y)-y.sum())/len(y)*100:.1f}%)")

# 3. Scale Features
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# 4. Train Models
lr_model = LogisticRegression(random_state=42, max_iter=1000)
rf_model = RandomForestClassifier(n_estimators=100, random_state=42)

lr_model.fit(X_scaled, y)
rf_model.fit(X_scaled, y)

# 5. Feature Importance (RF)
feature_importance = pd.DataFrame({
    'feature': feature_columns,
    'importance': rf_model.feature_importances_
}).sort_values('importance', ascending=False)

print(feature_importance)

plt.figure(figsize=(10,6))
sns.barplot(x='importance', y='feature', data=feature_importance)
plt.title("Random Forest Feature Importance")
plt.tight_layout()
plt.show()

# 6. Cross-Validation: Confusion & ROC
def cross_val_confusion_roc(model, X, y, cv):
    cms, tprs, aucs = [], [], []
    mean_fpr = np.linspace(0,1,100)
    
    for train_idx, test_idx in cv.split(X, y):
        X_train, X_test = X[train_idx], X[test_idx]
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

# 5-Fold CV
kf = KFold(n_splits=5, shuffle=True, random_state=42)
rf_cm_5fold, rf_fpr_5, rf_tpr_5, rf_auc_5 = cross_val_confusion_roc(rf_model, X_scaled, y, kf)

plt.figure(figsize=(5,4))
sns.heatmap(rf_cm_5fold, annot=True, fmt=".1f", cmap='Greens',
            xticklabels=['Focused','Doomscrolling'], yticklabels=['Focused','Doomscrolling'])
plt.title("Random Forest 5-Fold CV Confusion Matrix")
plt.xlabel("Predicted")
plt.ylabel("Actual")
plt.show()

plt.figure(figsize=(6,5))
plt.plot(rf_fpr_5, rf_tpr_5, label=f'Random Forest 5-Fold (AUC={rf_auc_5:.2f})')
plt.plot([0,1],[0,1],'k--')
plt.xlabel('False Positive Rate')
plt.ylabel('True Positive Rate')
plt.title('ROC Curve (5-Fold CV)')
plt.legend()
plt.show()

# LOOCV
loo = LeaveOneOut()
y_true, y_pred, y_proba = [], [], []

for train_idx, test_idx in loo.split(X_scaled, y):
    X_train, X_test = X_scaled[train_idx], X_scaled[test_idx]
    y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
    
    rf_model.fit(X_train, y_train)
    pred = rf_model.predict(X_test)
    proba = rf_model.predict_proba(X_test)[:,1]
    
    y_true.append(y_test.values[0])
    y_pred.append(pred[0])
    y_proba.append(proba[0])

loo_cm = confusion_matrix(y_true, y_pred)
fpr, tpr, _ = roc_curve(y_true, y_proba)
roc_auc = auc(fpr, tpr)

plt.figure(figsize=(5,4))
sns.heatmap(loo_cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=['Focused', 'Doomscrolling'],
            yticklabels=['Focused', 'Doomscrolling'])
plt.xlabel('Predicted')
plt.ylabel('True')
plt.title('Random Forest LOOCV Confusion Matrix')
plt.show()

plt.figure(figsize=(6,5))
plt.plot(fpr, tpr, label=f'Random Forest LOOCV (AUC={roc_auc:.2f})')
plt.plot([0,1],[0,1],'k--')
plt.xlabel('FPR')
plt.ylabel('TPR')
plt.title('ROC Curve (LOOCV)')
plt.legend()
plt.show()

# 7. Exploratory Data Analysis
  # Histograms per feature
for feature in feature_columns:
    plt.figure(figsize=(6,4))
    sns.histplot(df, x=feature, hue='is_doomscrolling', kde=True, element="step", stat="density")
    plt.title(f"Distribution of {feature} by Label")
    plt.show()

# Correlation Matrix
plt.figure(figsize=(10,8))
corr = df[feature_columns + ['is_doomscrolling']].corr()
sns.heatmap(corr, annot=True, cmap="coolwarm")
plt.title("Correlation Matrix")
plt.show()

# Pairplot for key features
sns.pairplot(df, vars=['Duration (minutes)','Engagement Score','Scroll Intensity (px/min)'],
             hue='is_doomscrolling', corner=True)
plt.show()

# 8. To-do Analyze Feature Importance
# Comments: Feature importance already analyzed above using Random Forest - Total Scroll Distance, Total Clicks, and Scroll Events Count are top features.
corr_matrix = df[feature_columns].corr()
plt.figure(figsize=(10,8))
sns.heatmap(corr_matrix, annot=True, cmap="coolwarm")
plt.title("Feature Correlation Matrix")
plt.show()

for feature in feature_columns:
    plt.figure(figsize=(6,4))
    sns.kdeplot(data=df, x=feature, hue='is_doomscrolling', common_norm=False)
    plt.title(f"{feature} distribution by label")
    plt.show()

# Example: Log transform skewed features
df['Log_Total_Scroll'] = np.log1p(df['Total Scroll Distance'])
df['Log_Engagement_Score'] = np.log1p(df['Engagement Score'])
