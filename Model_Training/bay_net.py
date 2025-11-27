import pandas as pd
from pgmpy.models import BayesianNetwork
from pgmpy.estimators import MaximumLikelihoodEstimator, VariableElimination

data = pd.read_csv('scroll_data.csv')

def classify_scroll_rate(scrolls, duration):
    rate = scrolls / (duration+1e-6)
    if rate > 30:
        return 'high'
    elif rate > 10:
        return 'medium'
    else:
        return 'low'
    
def classify_click_rate(clicks, duration):
    rate = clicks / (duration+1e-6)
    if rate > 2:
        return 'high'
    elif rate > 0.5:
        return 'medium'
    else:
        return 'low'

def classify_duration(duration):
    if duration > 30:
        return 'long'
    elif duration > 10:
        return 'medium'
    else:
        return 'short'
    
data['ScrollRate'] = data.apply(lambda row: classify_scroll_rate(row['TotalScrolls'], row['Duration']), axis=1)
data['ClickRate'] = data.apply(lambda row: classify_click_rate(row['TotalClicks'], row['Duration']), axis=1)
data['SessionLength'] = data['Duration'].apply(classify_duration)

data['Doomscrolling'] = data.apply(lambda row: 'yes' if row['ScrollRate'] == 'high' and row['SessionLength'] == 'long' else 'no', axis=1)

model = BayesianNetwork([('ScrollRate', 'Doomscrolling'), ('ClickRate', 'Doomscrolling'), ('SessionLength', 'Doomscrolling')])

model.fit(data, estimator=MaximumLikelihoodEstimator)
inference = VariableElimination(model)
query = inference.query(variables=['Doomscrolling'], evidence={'ScrollRate': 'high', 'ClickRate': 'low', 'SessionLength': 'long'})

print(query)

for cpd in model.get_cpds():
    print("CDP of {variable}:".format(variable=cpd.variable))
    print(cpd)