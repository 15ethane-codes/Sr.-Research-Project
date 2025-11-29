import pandas as pd
from pgmpy.models import DiscreteBayesianNetwork
from pgmpy.estimators import MaximumLikelihoodEstimator
from pgmpy.inference import VariableElimination
import os

# Get current working directory
cwd = os.getcwd()
print("Current working directory:", cwd)

file_path = os.path.join(cwd, "Model_Training", "session_data.csv")
print("Full path to CSV:", file_path)

if os.path.isfile(file_path):
    print("File found! Loading now...")
    df = pd.read_csv(file_path)
    print("CSV loaded successfully.")
else:
    raise FileNotFoundError("CSV file not found. Check filename and folder.")

# Feature engineering
df['ScrollRate'] = df.apply(lambda row: (
    'high' if row['Scroll Events Count'] / (row['Duration (minutes)'] + 1e-6) > 30 else
    'medium' if row['Scroll Events Count'] / (row['Duration (minutes)'] + 1e-6) > 10 else 'low'
), axis=1)

df['ClickRate'] = df.apply(lambda row: (
    'high' if row['Total Clicks'] / (row['Duration (minutes)'] + 1e-6) > 2 else
    'medium' if row['Total Clicks'] / (row['Duration (minutes)'] + 1e-6) > 0.5 else 'low'
), axis=1)

df['SessionLength'] = df['Duration (minutes)'].apply(lambda d: 'long' if d > 30 else 'medium' if d > 10 else 'short')

# Map manually - labeled column to 'yes'/'no' for consistency
df['Doomscrolling'] = df['doomscroll_label'].map({1: 'yes', 0: 'no'})

model = DiscreteBayesianNetwork([
    ('ScrollRate', 'Doomscrolling'),
    ('ClickRate', 'Doomscrolling'),
    ('SessionLength', 'Doomscrolling')
])

model.fit(df, estimator=MaximumLikelihoodEstimator)
inference = VariableElimination(model)

# Example query
query_result = inference.query(
    variables=['Doomscrolling'],
    evidence={'ScrollRate': 'high', 'ClickRate': 'low', 'SessionLength': 'long'}
)
print("Query result for ScrollRate=high, ClickRate=low, SessionLength=long:")
print(query_result)

for cpd in model.get_cpds():
    print(f"CPD of {cpd.variable}:")
    print(cpd)

result = inference.query(
    variables=['Doomscrolling'],
    evidence={'ScrollRate': 'high', 'ClickRate': 'low', 'SessionLength': 'long'}
)
print(result)

# Error
with open("cpds.txt", "w") as f:
    for cpd in model.get_cpds():
        f.write(f"CPD of {cpd.variable}:\n")
        f.write(str(cpd))
        f.write("\n\n")

for cpd in model.get_cpds():
    df_cpd = pd.DataFrame(cpd.values, index=cpd.state_names[cpd.variable])
    df_cpd.to_csv(f"{cpd.variable}_cpd.csv")
