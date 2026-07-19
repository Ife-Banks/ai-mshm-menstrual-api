# scripts/retrain_dl_models.py
# Quick script: retrain only DL models with CastMask/LastTimestep (no Lambda)
# Uses the same training pipeline as export_v8_models.py but skips sklearn models

import warnings
warnings.filterwarnings('ignore')
import os, sys
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

import numpy as np
import pandas as pd
import pickle
import json
from sklearn.model_selection import GroupShuffleSplit
from sklearn.preprocessing import StandardScaler
import tensorflow as tf
from tensorflow.keras import layers, models, callbacks

RANDOM_STATE = 42
np.random.seed(RANDOM_STATE)
tf.random.set_seed(RANDOM_STATE)
rng = np.random.default_rng(RANDOM_STATE)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(SCRIPT_DIR, '..', '..', 'New docs', 'AI-MSHM_HRV_rPPG_Dataset_v8.csv')
OUT_DIR = os.path.join(SCRIPT_DIR, '..', 'models', 'rppg_v8')
os.makedirs(OUT_DIR, exist_ok=True)

# Load dataset
print(f"Loading dataset from {DATASET_PATH}...")
df = pd.read_csv(DATASET_PATH)
print(f"Dataset shape: {df.shape}")

# ── Features ────────────────────────────────────────────────────────────────
ALL_FEATURES = ['RMSSD', 'HF', 'LF_HF_Ratio', 'Heart_Rate', 'Heart_Rate_Variability_HRV',
                'Estimated_SpO2', 'Skin_Temperature', 'HR_Trend',
                'Mean_EDA', 'Mean_Temp', 'Autonomic_Stress_Index', 'RMSSD_Trend']

CORE_TARGETS = ['Sleep_Quality', 'Focus_Memory', 'Mental_Wellness', 'Mood_Score']

REG_FEATS = {
    'Sleep_Quality': ['RMSSD', 'HF', 'LF_HF_Ratio', 'Heart_Rate', 'Estimated_SpO2', 'Skin_Temperature'],
    'Focus_Memory': ['RMSSD', 'LF_HF_Ratio', 'Heart_Rate', 'Heart_Rate_Variability_HRV'],
    'Mental_Wellness': ['RMSSD', 'LF_HF_Ratio', 'HF', 'Heart_Rate'],
    'Mood_Score': ['RMSSD', 'LF_HF_Ratio', 'HR_Trend', 'Skin_Temperature'],
}

MAX_LEN = 6

# ── Custom layers ───────────────────────────────────────────────────────────
class CastMask(layers.Layer):
    def call(self, m):
        return tf.cast(tf.expand_dims(m, axis=1), tf.bool)

class LastTimestep(layers.Layer):
    def call(self, t):
        return t[:, -1, :]

# ── Build functions ─────────────────────────────────────────────────────────
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
            X_list.append(Xseq); y_list.append(tgt[i]); g_list.append(sid); m_list.append(mask)
    return np.array(X_list), np.array(y_list), np.array(g_list), np.array(m_list)

# ── Load existing bundle for scaler info ────────────────────────────────────
BUNDLE_PATH = os.path.join(OUT_DIR, 'rppg_v8_bundle.pkl')
with open(BUNDLE_PATH, 'rb') as f:
    bundle = pickle.load(f)
existing_dl = bundle.get('dl_models', {})

# ── Train split (same as export script) ─────────────────────────────────────
gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=RANDOM_STATE)
reg_splits = {}
for t in CORE_TARGETS:
    for tr_idx, te_idx in gss.split(df, groups=df['Subject_ID']):
        reg_splits[t] = (tr_idx, te_idx)

# ── Retrain DL models ──────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("Retraining DL models with CastMask/LastTimestep layers")
print("=" * 60)

for target in CORE_TARGETS:
    feats = REG_FEATS[target]
    tr_idx, te_idx = reg_splits[target]
    train_df = df.iloc[tr_idx]
    test_df = df.iloc[te_idx]

    Xtr, ytr, gtr, mtr = build_sequences(train_df, feats, target)
    Xte, yte, gte, mte = build_sequences(test_df, feats, target)

    y_mean, y_std = ytr.mean(), ytr.std()
    ytr_s = (ytr - y_mean) / y_std
    yte_s = (yte - y_mean) / y_std

    n_feat = len(feats)

    rng_t = np.random.default_rng(42)
    uniq = np.unique(gtr); rng_t.shuffle(uniq)
    n_val = max(1, int(0.15 * len(uniq)))
    val_sids = set(uniq[:n_val])
    tr_mask = np.array([s not in val_sids for s in gtr])
    va_mask = ~tr_mask

    Xtr2_s = Xtr[tr_mask]; mtr2 = mtr[tr_mask]; ytr2_s = ytr_s[tr_mask]
    Xva_s = Xtr[va_mask]; mva = mtr[va_mask]; yva_s = ytr_s[va_mask]

    for model_name, build_fn in [('lstm_attn', build_lstm_attention), ('transformer', build_transformer)]:
        model = build_fn(MAX_LEN, n_feat)
        es = callbacks.EarlyStopping(monitor='val_loss', patience=15, restore_best_weights=True)
        hist = model.fit(
            [Xtr2_s, mtr2], ytr2_s,
            validation_data=([Xva_s, mva], yva_s),
            epochs=150, batch_size=64, callbacks=[es], verbose=0
        )
        from sklearn.metrics import r2_score
        pred = model.predict([Xte, mte], verbose=0).ravel() * y_std + y_mean
        r2 = r2_score(yte, pred)
        print(f"  {target:20s} {model_name:15s} R2={r2:.4f} ({len(hist.history['loss'])} epochs)")

        keras_path = os.path.join(OUT_DIR, f"dl_{target}_{model_name}.keras")
        model.save(keras_path)
        print(f"    Saved {keras_path}")

        # Update bundle metadata (DL models don't store weights in bundle)
        key = f"{target}_{model_name}"
        existing_dl[key] = {
            'y_mean': float(y_mean),
            'y_std': float(y_std),
            'seq_len': MAX_LEN,
            'n_feat': n_feat,
            'features': feats,
        }

# Update bundle
bundle['dl_models'] = existing_dl
with open(BUNDLE_PATH, 'wb') as f:
    pickle.dump(bundle, f)
print("\nUpdated bundle with new DL metadata.")

print("\nDone. Now run: python scripts/convert_rppg_v8_to_onnx.py")
