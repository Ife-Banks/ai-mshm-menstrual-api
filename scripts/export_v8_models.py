# scripts/export_v8_models.py
# Run: python scripts/export_v8_models.py
# Requirements: pip install numpy pandas scikit-learn
#
# Trains and saves ONLY the models that beat all alternatives:
#   - LinearRegression for all 10 regression targets (R2=0.9995, best on every target)
#   - MLP for Mood_Check classification (95.06% accuracy, best of 7 algorithms)
#   - RandomForest regressor per risk domain (10 domains, flag derived from score)
#
# Produces v8_training_metadata.json with scaler params for ONNX inference.
# Run convert_rppg_v8_to_onnx.py next to produce ONNX files.

import warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import json
import os
import pickle
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import r2_score, accuracy_score

RANDOM_STATE = 42
np.random.seed(RANDOM_STATE)
rng = np.random.default_rng(RANDOM_STATE)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(SCRIPT_DIR, '..', '..', 'New docs', 'AI-MSHM_HRV_rPPG_Dataset_v8.csv')
OUT_DIR = os.path.join(SCRIPT_DIR, '..', 'models', 'rppg_v8')
os.makedirs(OUT_DIR, exist_ok=True)

print(f"Loading dataset from {DATASET_PATH}...")
df = pd.read_csv(DATASET_PATH)
print(f"Dataset shape: {df.shape}")

ALL_FEATURES = [
    'RMSSD', 'HF', 'LF_HF_Ratio', 'Heart_Rate', 'Heart_Rate_Variability_HRV',
    'Estimated_SpO2', 'Skin_Temperature', 'HR_Trend', 'Mean_EDA', 'Mean_Temp',
    'Autonomic_Stress_Index', 'RMSSD_Trend'
]

REG_FEATS = {
    'Sleep_Quality':   ['RMSSD', 'HF', 'LF_HF_Ratio', 'Heart_Rate', 'Estimated_SpO2', 'Skin_Temperature'],
    'Focus_Memory':    ['RMSSD', 'LF_HF_Ratio', 'Heart_Rate', 'Heart_Rate_Variability_HRV'],
    'Mental_Wellness': ['RMSSD', 'LF_HF_Ratio', 'HF', 'Heart_Rate'],
    'Mood_Score':      ['RMSSD', 'LF_HF_Ratio', 'HR_Trend', 'Skin_Temperature'],
    'Metabolic_Syndrome_Risk':       ['RMSSD', 'Mean_EDA', 'Mean_Temp'],
    'T2D_Metabolic_Risk_Index':      ['Mean_Temp', 'RMSSD'],
    'Cardiovascular_Risk_Score':     ['RMSSD', 'Mean_EDA'],
    'Heart_Failure_Alert_Score':     ['RMSSD_Trend', 'Mean_Temp'],
    'Chronic_Stress_Severity':       ['Mean_EDA', 'RMSSD'],
    'Infertility_Reproductive_Risk': ['Autonomic_Stress_Index', 'RMSSD', 'Mean_EDA'],
}

RISK_FEATS = {
    'Sleep_Quality':       (['RMSSD', 'HF', 'LF_HF_Ratio', 'Heart_Rate', 'Estimated_SpO2', 'Skin_Temperature'], 'Sleep_Quality'),
    'Focus_Memory':        (['RMSSD', 'LF_HF_Ratio', 'Heart_Rate', 'Heart_Rate_Variability_HRV'], 'Focus_Memory'),
    'Mental_Wellness':     (['RMSSD', 'LF_HF_Ratio', 'HF', 'Heart_Rate'], 'Mental_Wellness'),
    'Mood_Check':          (['RMSSD', 'LF_HF_Ratio', 'HR_Trend', 'Skin_Temperature'], 'Mood_Score'),
    'Metabolic_Syndrome':  (['RMSSD', 'Mean_EDA', 'Mean_Temp'], 'Metabolic_Syndrome_Risk'),
    'Type_2_Diabetes':     (['Mean_Temp', 'RMSSD'], 'T2D_Metabolic_Risk_Index'),
    'Cardiovascular_Disease': (['RMSSD', 'Mean_EDA'], 'Cardiovascular_Risk_Score'),
    'Heart_Failure':       (['RMSSD_Trend', 'Mean_Temp'], 'Heart_Failure_Alert_Score'),
    'Chronic_Stress':      (['Mean_EDA', 'RMSSD'], 'Chronic_Stress_Severity'),
    'Infertility':         (['Autonomic_Stress_Index', 'RMSSD', 'Mean_EDA'], 'Infertility_Reproductive_Risk'),
}

MOOD_FEATS = ['RMSSD', 'LF_HF_Ratio', 'HR_Trend', 'Skin_Temperature']

df['Risk_Flag'] = df['RMSSD'].apply(lambda r: 'At Risk' if r < 30 else 'Normal')
risk_flag_le = LabelEncoder()
risk_flag_le.fit(df['Risk_Flag'])

# ═══════════════════════════════════════════════════════════════════════════
# 1. Train LinearRegression — all 10 targets
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("1. Training LinearRegression (all 10 targets)")
print("=" * 60)

reg_splits = {}
for target in REG_FEATS:
    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=RANDOM_STATE)
    tr_idx, te_idx = next(gss.split(df[REG_FEATS[target]].values, df[target].values, groups=df['Subject_ID'].values))
    reg_splits[target] = (tr_idx, te_idx)

regression_models = {}
scalers = {}

for target, feats in REG_FEATS.items():
    tr_idx, te_idx = reg_splits[target]
    X = df[feats].values
    y = df[target].values

    sc = StandardScaler().fit(X[tr_idx])
    Xtr, Xte = sc.transform(X[tr_idx]), sc.transform(X[te_idx])
    scalers[target] = {'mean': sc.mean_.tolist(), 'scale': sc.scale_.tolist(), 'features': feats}

    lr = LinearRegression().fit(Xtr, y[tr_idx])
    pred = lr.predict(Xte)
    r2 = r2_score(y[te_idx], pred)
    regression_models[target] = lr
    print(f"  {target:32s} R2={r2:.4f}")

# ═══════════════════════════════════════════════════════════════════════════
# 2. Train risk scoring models — RF regressor per domain
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("2. Training risk scoring regressors (10 domains)")
print("=" * 60)

risk_models = {}

for domain, (feats, score_col) in RISK_FEATS.items():
    X = df[feats].values
    y_score = df[score_col].values
    groups = df['Subject_ID'].values

    gss_r = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=RANDOM_STATE)
    tr_idx, te_idx = next(gss_r.split(X, y_score, groups=groups))

    scaler = StandardScaler()
    X_tr = scaler.fit_transform(X[tr_idx])
    X_te = scaler.transform(X[te_idx])

    reg = RandomForestRegressor(n_estimators=300, random_state=RANDOM_STATE, n_jobs=1)
    reg.fit(X_tr, y_score[tr_idx])

    r2 = r2_score(y_score[te_idx], reg.predict(X_te))
    print(f"  {domain:24s} score R2={r2:.3f}")

    risk_models[domain] = {
        'regressor': reg,
        'features': feats,
        'score_column': score_col,
        'scaler': {'mean': scaler.mean_.tolist(), 'scale': scaler.scale_.tolist()},
    }

# ═══════════════════════════════════════════════════════════════════════════
# 3. Train Mood_Check — MLP only (95.06% accuracy, best of 7 algorithms)
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("3. Training Mood_Check classifier (MLP only)")
print("=" * 60)

le_mood = LabelEncoder()
y_mood = le_mood.fit_transform(df['Mood_Check'])
Xtr_m, Xte_m, ytr_m, yte_m = train_test_split(
    df[MOOD_FEATS].values, y_mood, test_size=0.2, random_state=RANDOM_STATE, stratify=y_mood
)
sc_mood = StandardScaler().fit(Xtr_m)
Xtr_ms, Xte_ms = sc_mood.transform(Xtr_m), sc_mood.transform(Xte_m)

mlp = MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=500, random_state=RANDOM_STATE, early_stopping=True)
mlp.fit(Xtr_ms, ytr_m)
mlp_acc = accuracy_score(yte_m, mlp.predict(Xte_ms))
print(f"  MLP accuracy={mlp_acc:.4f}")

# ═══════════════════════════════════════════════════════════════════════════
# 4. Save metadata JSON
# ═══════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 60)
print("4. Saving metadata JSON")
print("=" * 60)

metadata = {
    'version': 'v8',
    'all_features': ALL_FEATURES,
    'n_features_total': len(ALL_FEATURES),
    'regression_targets': list(REG_FEATS.keys()),
    'risk_domains': list(RISK_FEATS.keys()),
    'per_target_features': {t: feats for t, feats in REG_FEATS.items()},
    'regression_scalers': scalers,
    'mood_check': {
        'features': MOOD_FEATS,
        'classes': le_mood.classes_.tolist(),
        'best_model': 'MLP',
        'accuracy': float(mlp_acc),
        'scaler': {'mean': sc_mood.mean_.tolist(), 'scale': sc_mood.scale_.tolist()},
    },
    'risk_domain_features': {d: {'features': feats, 'score_column': sc} for d, (feats, sc) in RISK_FEATS.items()},
    'risk_flag_classes': risk_flag_le.classes_.tolist(),
    'hrv_status_thresholds': {
        'Normal/Excellent': 50,
        'Slightly Reduced': 40,
        'Moderately Reduced': 30,
        'Low': 20,
        'Very Low': 10,
        'Extremely Low': 0,
    },
    'feature_index_map': {f'f{i}': name for i, name in enumerate(ALL_FEATURES)},
    'regression_models': {t: {'model': m, 'features': REG_FEATS[t]} for t, m in regression_models.items()},
    'risk_models': risk_models,
    'mood_model': mlp,
}

meta_path = os.path.join(OUT_DIR, 'v8_training_metadata.json')
with open(meta_path, 'w') as f:
    json.dump(metadata, f, indent=2, default=str)
print(f"  Saved {meta_path}")

models_dir = os.path.join(OUT_DIR, '_sk_models')
os.makedirs(models_dir, exist_ok=True)

for target, model in regression_models.items():
    with open(os.path.join(models_dir, f'reg_{target}.pkl'), 'wb') as f:
        pickle.dump(model, f)

for domain, rm in risk_models.items():
    with open(os.path.join(models_dir, f'risk_{domain}_regressor.pkl'), 'wb') as f:
        pickle.dump(rm['regressor'], f)

with open(os.path.join(models_dir, 'mood_MLP.pkl'), 'wb') as f:
    pickle.dump(mlp, f)

print(f"  Saved {len(regression_models) + len(risk_models) + 1} model files to {models_dir}")

print("\n" + "=" * 60)
print("DONE — run `python scripts/convert_rppg_v8_to_onnx.py` next")
print("=" * 60)
