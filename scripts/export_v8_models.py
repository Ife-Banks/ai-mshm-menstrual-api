# scripts/export_v8_models.py
# Run: python scripts/export_v8_models.py
# Requirements: pip install numpy pandas scikit-learn lightgbm tensorflow joblib
#
# This script replicates the training pipeline from AI-MSHM_v8_Final.ipynb
# and exports all trained models to a single .pkl bundle for ONNX conversion.

import warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import pickle
import json
import os
from sklearn.model_selection import GroupShuffleSplit, train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import (RandomForestRegressor, RandomForestClassifier,
                               HistGradientBoostingRegressor, HistGradientBoostingClassifier,
                               ExtraTreesClassifier)
from sklearn.svm import SVC
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import r2_score, accuracy_score
import lightgbm as lgb

RANDOM_STATE = 42
np.random.seed(RANDOM_STATE)
rng = np.random.default_rng(RANDOM_STATE)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(SCRIPT_DIR, '..', '..', 'New docs', 'AI-MSHM_HRV_rPPG_Dataset_v8.csv')
OUT_DIR = os.path.join(SCRIPT_DIR, '..', 'models', 'rppg_v8')
os.makedirs(OUT_DIR, exist_ok=True)

# ── Load dataset ────────────────────────────────────────────────────────────
print(f"Loading dataset from {DATASET_PATH}...")
df = pd.read_csv(DATASET_PATH)
print(f"Dataset shape: {df.shape}")

# ── Feature definitions (must match the notebook exactly) ──────────────────
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

# Risk scoring domains map domain names to (feature_list, score_column)
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

CORE_TARGETS = ['Sleep_Quality', 'Focus_Memory', 'Mental_Wellness', 'Mood_Score']
NEW_TARGETS = [t for t in REG_FEATS if t not in CORE_TARGETS]
MOOD_FEATS = ['RMSSD', 'LF_HF_Ratio', 'HR_Trend', 'Skin_Temperature']

# ── Risk flag (RMSSD < 30 = At Risk) ──────────────────────────────────────
df['Risk_Flag'] = df['RMSSD'].apply(lambda r: 'At Risk' if r < 30 else 'Normal')
risk_flag_le = LabelEncoder()
y_flag_all = risk_flag_le.fit_transform(df['Risk_Flag'])
at_risk_idx = list(risk_flag_le.classes_).index('At Risk')

# ── Split indices ───────────────────────────────────────────────────────────
reg_splits = {}
gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=RANDOM_STATE)
for target, feats in REG_FEATS.items():
    X = df[feats].values
    y = df[target].values
    groups = df['Subject_ID'].values
    tr_idx, te_idx = next(gss.split(X, y, groups=groups))
    reg_splits[target] = (tr_idx, te_idx)

# ── 1. Train regression models ─────────────────────────────────────────────
print("\n" + "=" * 60)
print("1. Training regression models (all 10 targets)")
print("=" * 60)

regression_models = {}
scalers = {}

for target, feats in REG_FEATS.items():
    tr_idx, te_idx = reg_splits[target]
    X = df[feats].values
    y = df[target].values

    sc = StandardScaler().fit(X[tr_idx])
    Xtr, Xte = sc.transform(X[tr_idx]), sc.transform(X[te_idx])
    scalers[target] = {'mean': sc.mean_.tolist(), 'scale': sc.scale_.tolist(), 'features': feats}

    models = {}

    # LinearRegression
    lr = LinearRegression().fit(Xtr, y[tr_idx])
    pred = lr.predict(Xte)
    r2 = r2_score(y[te_idx], pred)
    models['LinearRegression'] = lr
    print(f"  {target:32s} LR   R2={r2:.4f}")

    # RandomForest
    rf = RandomForestRegressor(n_estimators=300, max_depth=10, random_state=RANDOM_STATE, n_jobs=1)
    rf.fit(Xtr, y[tr_idx])
    pred = rf.predict(Xte)
    r2 = r2_score(y[te_idx], pred)
    models['RandomForest'] = rf
    print(f"  {target:32s} RF   R2={r2:.4f}")

    # HistGradientBoosting
    hgb = HistGradientBoostingRegressor(max_iter=300, max_depth=4, learning_rate=0.08, random_state=RANDOM_STATE)
    hgb.fit(Xtr, y[tr_idx])
    pred = hgb.predict(Xte)
    r2 = r2_score(y[te_idx], pred)
    models['HistGradientBoosting'] = hgb
    print(f"  {target:32s} HGB  R2={r2:.4f}")

    regression_models[target] = models

# ── 2. Train risk scoring models (RF clf + RF reg per domain) ──────────────
print("\n" + "=" * 60)
print("2. Training risk scoring models (10 domains)")
print("=" * 60)

risk_models = {}

for domain, (feats, score_col) in RISK_FEATS.items():
    X = df[feats].values
    y_score = df[score_col].values
    y_flag = y_flag_all
    groups = df['Subject_ID'].values

    gss_r = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=RANDOM_STATE)
    tr_idx, te_idx = next(gss_r.split(X, y_score, groups=groups))

    scaler = StandardScaler()
    X_tr = scaler.fit_transform(X[tr_idx])
    X_te = scaler.transform(X[te_idx])

    # Regressor
    reg = RandomForestRegressor(n_estimators=300, random_state=RANDOM_STATE, n_jobs=1)
    reg.fit(X_tr, y_score[tr_idx])

    # Classifier
    clf = RandomForestClassifier(n_estimators=300, random_state=RANDOM_STATE, n_jobs=1)
    clf.fit(X_tr, y_flag[tr_idx])

    r2 = r2_score(y_score[te_idx], reg.predict(X_te))
    acc = accuracy_score(y_flag[te_idx], clf.predict(X_te))
    print(f"  {domain:24s} score R2={r2:.3f} | flag acc={acc:.3f}")

    risk_models[domain] = {
        'regressor': reg,
        'classifier': clf,
        'features': feats,
        'score_column': score_col,
        'scaler': {'mean': scaler.mean_.tolist(), 'scale': scaler.scale_.tolist()},
    }

# ── 3. Train Mood_Check classifiers (7 algorithms) ─────────────────────────
print("\n" + "=" * 60)
print("3. Training Mood_Check classifiers (7 algorithms)")
print("=" * 60)

le_mood = LabelEncoder()
y_mood = le_mood.fit_transform(df['Mood_Check'])
Xtr_m, Xte_m, ytr_m, yte_m = train_test_split(
    df[MOOD_FEATS].values, y_mood, test_size=0.2, random_state=RANDOM_STATE, stratify=y_mood
)
sc_mood = StandardScaler().fit(Xtr_m)
Xtr_ms, Xte_ms = sc_mood.transform(Xtr_m), sc_mood.transform(Xte_m)

mood_classifiers = {
    'LightGBM': lgb.LGBMClassifier(n_estimators=300, max_depth=6, learning_rate=0.08,
                                    random_state=RANDOM_STATE, verbosity=-1),
    'ExtraTrees': ExtraTreesClassifier(n_estimators=400, max_depth=14, random_state=RANDOM_STATE, n_jobs=1),
    'KNN': KNeighborsClassifier(n_neighbors=15, weights='distance'),
    'RandomForest': RandomForestClassifier(n_estimators=400, max_depth=14, random_state=RANDOM_STATE, n_jobs=1),
    'SVM': SVC(C=10, gamma='scale', kernel='rbf', probability=True, random_state=RANDOM_STATE),
    'MLP': MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=500, random_state=RANDOM_STATE, early_stopping=True),
    'HistGradientBoosting': HistGradientBoostingClassifier(max_iter=300, max_depth=4, learning_rate=0.08,
                                                             random_state=RANDOM_STATE),
}

best_mood_name = None
best_mood_acc = 0
best_mood_model = None

for name, m in mood_classifiers.items():
    m.fit(Xtr_ms, ytr_m)
    pred = m.predict(Xte_ms)
    acc = accuracy_score(yte_m, pred)
    print(f"  {name:22s} accuracy={acc:.4f}")
    if acc > best_mood_acc:
        best_mood_acc = acc
        best_mood_name = name
        best_mood_model = m

print(f"\n  Best: {best_mood_name} (accuracy={best_mood_acc:.4f})")

# ── 4. Train Deep Learning models (LSTM+Attention, Transformer) ────────────
# Note: These require TensorFlow. If TF is not available, skip and warn.
dl_models = {}
dl_scalers = {}

try:
    import tensorflow as tf
    from tensorflow.keras import layers, models, callbacks

    tf.random.set_seed(RANDOM_STATE)

    MAX_LEN = 6

    def build_sequences(sub_df, feats, target, max_len=MAX_LEN):
        X_list, y_list, g_list, m_list = [], [], [], []
        for sid, g in sub_df.sort_values('Trial').groupby('Subject_ID'):
            vals = g[feats].values
            tgt = g[target].values
            n = len(g)
            for i in range(n):
                start = max(0, i - max_len + 1)
                window = vals[start:i + 1]
                t = len(window)
                pad = max_len - t
                Xseq = np.zeros((max_len, len(feats)))
                mask = np.zeros(max_len)
                Xseq[pad:] = window
                mask[pad:] = 1
                X_list.append(Xseq)
                y_list.append(tgt[i])
                g_list.append(sid)
                m_list.append(mask)
        return np.array(X_list), np.array(y_list), np.array(g_list), np.array(m_list)

    class CastMask(layers.Layer):
        def call(self, m):
            return tf.cast(tf.expand_dims(m, axis=1), tf.bool)

    class LastTimestep(layers.Layer):
        def call(self, t):
            return t[:, -1, :]

    DL_CUSTOM_OBJECTS = {'CastMask': CastMask, 'LastTimestep': LastTimestep}

    def build_lstm_attention(seq_len, n_feat, units=32, seed=42):
        tf.random.set_seed(seed)
        seq_in = layers.Input(shape=(seq_len, n_feat), name='seq')
        mask_in = layers.Input(shape=(seq_len,), name='mask')
        x = layers.Masking(mask_value=0.0)(seq_in)
        lstm_out = layers.LSTM(units, return_sequences=True)(x)
        attn_mask = CastMask()(mask_in)
        attn_out = layers.MultiHeadAttention(num_heads=2, key_dim=units // 2)(
            lstm_out, lstm_out, attention_mask=attn_mask)
        merged = layers.Add()([lstm_out, attn_out])
        merged = layers.LayerNormalization()(merged)
        pooled = LastTimestep()(merged)
        out = layers.Dense(16, activation='relu')(pooled)
        out = layers.Dense(1)(out)
        model = models.Model([seq_in, mask_in], out)
        model.compile(optimizer=tf.keras.optimizers.Adam(3e-3), loss='mse')
        return model

    def build_transformer(seq_len, n_feat, d_model=24, n_heads=3, d_ff=48, seed=42):
        tf.random.set_seed(seed)
        seq_in = layers.Input(shape=(seq_len, n_feat), name='seq')
        mask_in = layers.Input(shape=(seq_len,), name='mask')
        x = layers.Dense(d_model)(seq_in)
        attn_mask = CastMask()(mask_in)
        attn_out = layers.MultiHeadAttention(num_heads=n_heads, key_dim=d_model // n_heads)(
            x, x, attention_mask=attn_mask)
        x = layers.LayerNormalization()(x + attn_out)
        ffn = layers.Dense(d_ff, activation='relu')(x)
        ffn = layers.Dense(d_model)(ffn)
        x = layers.LayerNormalization()(x + ffn)
        pooled = LastTimestep()(x)
        out = layers.Dense(16, activation='relu')(pooled)
        out = layers.Dense(1)(out)
        model = models.Model([seq_in, mask_in], out)
        model.compile(optimizer=tf.keras.optimizers.Adam(3e-3), loss='mse')
        return model

    print("\n" + "=" * 60)
    print("4. Training Deep Learning models (4 core targets)")
    print("=" * 60)

    for target in CORE_TARGETS:
        feats = REG_FEATS[target]
        tr_idx, te_idx = reg_splits[target]
        train_df = df.iloc[tr_idx]
        test_df = df.iloc[te_idx]

        Xtr, ytr, gtr, mtr = build_sequences(train_df, feats, target)
        Xte, yte, gte, mte = build_sequences(test_df, feats, target)

        # Validation split
        rng_t = np.random.default_rng(42)
        uniq = np.unique(gtr)
        rng_t.shuffle(uniq)
        n_val = max(1, int(0.15 * len(uniq)))
        sel = np.isin(gtr, list(uniq[:n_val]))
        Xva, yva, mva = Xtr[sel], ytr[sel], mtr[sel]
        Xtr2, ytr2, mtr2 = Xtr[~sel], ytr[~sel], mtr[~sel]

        n_feat = Xtr2.shape[-1]
        xsc = StandardScaler().fit(Xtr2.reshape(-1, n_feat))
        dl_scalers[target] = {
            'mean': xsc.mean_.tolist(),
            'scale': xsc.scale_.tolist(),
            'features': feats,
        }

        def scale_seq(X, m):
            N, T, F = X.shape
            return xsc.transform(X.reshape(-1, F)).reshape(N, T, F) * m[:, :, None]

        Xtr2_s, Xva_s, Xte_s = scale_seq(Xtr2, mtr2), scale_seq(Xva, mva), scale_seq(Xte, mte)
        y_mean, y_std = ytr2.mean(), ytr2.std()
        ytr2_s = (ytr2 - y_mean) / y_std
        yva_s = (yva - y_mean) / y_std

        for model_name, build_fn in [('lstm_attn', build_lstm_attention), ('transformer', build_transformer)]:
            model = build_fn(MAX_LEN, n_feat)
            es = callbacks.EarlyStopping(monitor='val_loss', patience=15, restore_best_weights=True)
            hist = model.fit(
                [Xtr2_s, mtr2], ytr2_s,
                validation_data=([Xva_s, mva], yva_s),
                epochs=150, batch_size=64, callbacks=[es], verbose=0
            )
            pred = model.predict([Xte_s, mte], verbose=0).ravel() * y_std + y_mean
            r2 = r2_score(yte, pred)
            print(f"  {target:20s} {model_name:15s} R2={r2:.4f} ({len(hist.history['loss'])} epochs)")

            dl_models[f"{target}_{model_name}"] = {
                'y_mean': float(y_mean),
                'y_std': float(y_std),
                'seq_len': MAX_LEN,
                'n_feat': n_feat,
                'features': feats,
            }

            keras_path = os.path.join(OUT_DIR, f"dl_{target}_{model_name}.keras")
            model.save(keras_path)
            print(f"    Saved {keras_path}")

except ImportError:
    print("\n[WARN] TensorFlow not available — skipping deep learning models.")
    print("       Install with: pip install tensorflow")

# ── 5. Save the bundle ─────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("5. Saving model bundle")
print("=" * 60)

bundle = {
    'version': 'v8',
    'all_features': ALL_FEATURES,
    'regression_models': {},
    'risk_models': {},
    'mood_classifier': {
        'model': best_mood_model,
        'name': best_mood_name,
        'accuracy': best_mood_acc,
        'features': MOOD_FEATS,
        'scaler': {'mean': sc_mood.mean_.tolist(), 'scale': sc_mood.scale_.tolist()},
        'classes': le_mood.classes_.tolist(),
        'all_models': mood_classifiers,
    },
    'dl_models': {},
    'regression_scalers': scalers,
    'risk_flag_classes': risk_flag_le.classes_.tolist(),
    'hrv_status_thresholds': {
        'Normal/Excellent': 50,
        'Slightly Reduced': 40,
        'Moderately Reduced': 30,
        'Low': 20,
        'Very Low': 10,
        'Extremely Low': 0,
    },
}

# Serialize regression models
for target, models in regression_models.items():
    bundle['regression_models'][target] = {
        'models': models,
        'features': REG_FEATS[target],
        'scaler': scalers[target],
    }

# Serialize risk models
for domain, rm in risk_models.items():
    bundle['risk_models'][domain] = rm

# Serialize DL models
for key, dlm in dl_models.items():
    bundle['dl_models'][key] = dlm

bundle_path = os.path.join(OUT_DIR, 'rppg_v8_bundle.pkl')
with open(bundle_path, 'wb') as f:
    pickle.dump(bundle, f)

size_mb = os.path.getsize(bundle_path) / (1024 * 1024)
print(f"  Saved {bundle_path} ({size_mb:.1f} MB)")

# Save metadata JSON
metadata = {
    'version': 'v8',
    'all_features': ALL_FEATURES,
    'n_features_total': len(ALL_FEATURES),
    'regression_targets': list(REG_FEATS.keys()),
    'risk_domains': list(RISK_FEATS.keys()),
    'core_targets': CORE_TARGETS,
    'new_targets': NEW_TARGETS,
    'mood_check': {
        'features': MOOD_FEATS,
        'classes': le_mood.classes_.tolist(),
        'best_model': best_mood_name,
    },
    'dl_targets': CORE_TARGETS,
    'dl_max_seq_len': 6,
    'feature_index_map': {f'f{i}': name for i, name in enumerate(ALL_FEATURES)},
    'per_target_features': {t: feats for t, feats in REG_FEATS.items()},
    'risk_domain_features': {d: {'features': feats, 'score_column': sc} for d, (feats, sc) in RISK_FEATS.items()},
    'hrv_status_thresholds': {
        'Normal/Excellent': 50,
        'Slightly Reduced': 40,
        'Moderately Reduced': 30,
        'Low': 20,
        'Very Low': 10,
        'Extremely Low': 0,
    },
}

meta_path = os.path.join(OUT_DIR, 'v8_training_metadata.json')
with open(meta_path, 'w') as f:
    json.dump(metadata, f, indent=2)
print(f"  Saved {meta_path}")

print("\n" + "=" * 60)
print("DONE — run `python scripts/convert_rppg_v8_to_onnx.py` next")
print("=" * 60)
