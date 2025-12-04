import pandas as pd
from pgmpy.models import DiscreteBayesianNetwork
from pgmpy.estimators import MaximumLikelihoodEstimator
from pgmpy.inference import VariableElimination
import os
import matplotlib.pyplot as plt
import seaborn as sns
import itertools


cwd = os.getcwd()
print("Current working directory:", cwd)

file_path = os.path.join(cwd, "Model_Training", "session_data.csv")
print("Full path to CSV:", file_path)

# Check if file exists
if os.path.isfile(file_path):
    print("File found! Loading now...")
    df = pd.read_csv(file_path)
    print("CSV loaded successfully.")
else:
    raise FileNotFoundError("CSV file not found. Check filename and folder.")

# Feature Engineering

df['ScrollRate'] = df.apply(
    lambda row: (
        'high' if row['Scroll Events Count'] / (row['Duration (minutes)'] + 1e-6) > 30 else
        'medium' if row['Scroll Events Count'] / (row['Duration (minutes)'] + 1e-6) > 10 else
        'low'
    ),
    axis=1
)

df['ClickRate'] = df.apply(
    lambda row: (
        'high' if row['Total Clicks'] / (row['Duration (minutes)'] + 1e-6) > 2 else
        'medium' if row['Total Clicks'] / (row['Duration (minutes)'] + 1e-6) > 0.5 else
        'low'
    ),
    axis=1
)

df['SessionLength'] = df['Duration (minutes)'].apply(
    lambda d: 'long' if d > 30 else 'medium' if d > 10 else 'short'
)

df['Doomscrolling'] = df['doomscroll_label'].map({1: 'yes', 0: 'no'})

model = DiscreteBayesianNetwork([
    ('ScrollRate', 'Doomscrolling'),
    ('ClickRate', 'Doomscrolling'),
    ('SessionLength', 'Doomscrolling')
])

model.fit(df, estimator=MaximumLikelihoodEstimator)
inference = VariableElimination(model)

# Example query: probability of doomscrolling given certain features
query_result = inference.query(
    variables=['Doomscrolling'],
    evidence={'ScrollRate': 'high', 'ClickRate': 'low', 'SessionLength': 'long'}
)
print("Query result for ScrollRate=high, ClickRate=low, SessionLength=long:")
print(query_result)

for cpd in model.get_cpds():
    evidence = cpd.get_evidence()
    if evidence:
        states = [cpd.state_names[parent] for parent in evidence]
        parent_combinations = list(itertools.product(*states))
        rows = []
        for i, parent_state in enumerate(parent_combinations):
            probs = cpd.values
            # Handle shape for single parent
            if len(evidence) == 1:
                probs_for_row = probs[:, i] if probs.ndim > 1 else probs
            else:
                probs_for_row = probs.flatten() if probs.ndim > 1 else probs
            for state_name, prob in zip(cpd.state_names[cpd.variable], probs_for_row):
                row_dict = dict(zip(evidence, parent_state))
                row_dict[cpd.variable] = state_name
                row_dict['probability'] = prob
                rows.append(row_dict)
        df_cpd = pd.DataFrame(rows)
    else:
        # Node without parents
        df_cpd = pd.DataFrame({
            cpd.variable: cpd.state_names[cpd.variable],
            'probability': cpd.values
        })
    df_cpd.to_csv(f"{cpd.variable}_cpd.csv", index=False)


#Visual CPDs now after confirming they are saved in CSV

for cpd in model.get_cpds():
    # Only visualize CPDs with parents
    if cpd.evidence:
        df_cpd = pd.DataFrame(cpd.values, columns=cpd.state_names[cpd.evidence[0]], index=cpd.state_names[cpd.variable])
    else:
        df_cpd = pd.DataFrame(cpd.values, index=cpd.state_names[cpd.variable], columns=[cpd.variable])
    
    plt.figure(figsize=(6,4))
    sns.heatmap(df_cpd, annot=True, fmt=".2f", cmap="Blues")
    plt.title(f"CPD: {cpd.variable}")
    plt.ylabel(cpd.variable)
    plt.xlabel(", ".join(cpd.evidence) if cpd.evidence else "Probability")
    plt.show()