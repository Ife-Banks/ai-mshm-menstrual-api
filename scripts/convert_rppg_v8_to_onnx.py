# scripts/convert_rppg_v8_to_onnx.py
# Run: python scripts/convert_rppg_v8_to_onnx.py
# Requirements: pip install scikit-learn onnx onnxmltools onnxruntime skl2onnx numpy pandas
#
# Reads the individual .pkl model files produced by export_v8_models.py
# and converts ONLY the kept models to ONNX:
#   - LinearRegression × 10 targets
#   - MLP classifier × 1 (Mood_Check)
#   - RF regressor × 10 risk domains

import os
import json
import pickle
import warnings
warnings.filterwarnings('ignore')

import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SK_MODELS_DIR = os.path.join(SCRIPT_DIR, '..', 'models', 'rppg_v8', '_sk_models')
OUT_DIR = os.path.join(SCRIPT_DIR, '..', 'models', 'rppg_v8', 'onnx')
META_PATH = os.path.join(SCRIPT_DIR, '..', 'models', 'rppg_v8', 'v8_training_metadata.json')
os.makedirs(OUT_DIR, exist_ok=True)

with open(META_PATH, 'r') as f:
    meta = json.load(f)

def _initial_types(n_feat):
    from skl2onnx.common.data_types import FloatTensorType
    return [('input', FloatTensorType((None, n_feat)))]

def convert_regression(model, n_feat, out_path):
    from skl2onnx import convert_sklearn
    onx = convert_sklearn(model, initial_types=_initial_types(n_feat), target_opset=16)
    with open(out_path, 'wb') as f:
        f.write(onx.SerializeToString())

converted = []
skipped = []

def do_convert(model, n_feat, name, out_path, kind):
    if os.path.exists(out_path):
        converted.append(out_path)
        print(f"  [EXISTS] {name}")
        return
    try:
        convert_regression(model, n_feat, out_path)
        converted.append(out_path)
        print(f"  [OK]    {name}")
    except Exception as e:
        skipped.append((name, str(e)))
        print(f"  [ERR]   {name}: {e}")

# 1. LinearRegression — all 10 targets
print("=" * 60)
print("LinearRegression models")
print("=" * 60)

for target in meta['regression_targets']:
    n_feat = len(meta['per_target_features'][target])
    pkl_path = os.path.join(SK_MODELS_DIR, f'reg_{target}.pkl')
    onnx_path = os.path.join(OUT_DIR, f'reg_{target}_LinearRegression.onnx')
    if not os.path.exists(pkl_path):
        print(f"  [SKIP] {target}: pkl not found")
        continue
    with open(pkl_path, 'rb') as f:
        model = pickle.load(f)
    do_convert(model, n_feat, f'reg_{target}_LinearRegression', onnx_path, 'regression')

# 2. Risk regressors — RF regressor × 10 domains
print("\n" + "=" * 60)
print("Risk scoring regressors")
print("=" * 60)

for domain in meta['risk_domains']:
    feats = meta['risk_domain_features'][domain]['features']
    n_feat = len(feats)
    pkl_path = os.path.join(SK_MODELS_DIR, f'risk_{domain}_regressor.pkl')
    onnx_path = os.path.join(OUT_DIR, f'risk_{domain}_regressor.onnx')
    if not os.path.exists(pkl_path):
        print(f"  [SKIP] risk_{domain}_regressor: pkl not found")
        continue
    with open(pkl_path, 'rb') as f:
        model = pickle.load(f)
    do_convert(model, n_feat, f'risk_{domain}_regressor', onnx_path, 'regression')

# 3. Mood_Check — MLP only
print("\n" + "=" * 60)
print("Mood_Check classifier")
print("=" * 60)

pkl_path = os.path.join(SK_MODELS_DIR, 'mood_MLP.pkl')
onnx_path = os.path.join(OUT_DIR, 'mood_check_MLP.onnx')
if os.path.exists(pkl_path):
    with open(pkl_path, 'rb') as f:
        model = pickle.load(f)
    n_feat = len(meta['mood_check']['features'])
    do_convert(model, n_feat, 'mood_check_MLP', onnx_path, 'classification')
else:
    print("  [SKIP] mood_MLP: pkl not found")

# 4. Write ONNX metadata
print("\n" + "=" * 60)
print("Writing ONNX metadata")
print("=" * 60)

onnx_meta = {
    'version': 'v8',
    'converted': [os.path.basename(p) for p in converted],
    'skipped': [{'name': n, 'reason': r} for n, r in skipped],
}

meta_path = os.path.join(OUT_DIR, 'onnx_metadata.json')
with open(meta_path, 'w') as f:
    json.dump(onnx_meta, f, indent=2)

print(f"  Converted: {len(converted)}")
print(f"  Skipped:   {len(skipped)}")
print(f"  Output:    {OUT_DIR}")
print(f"\n  Converted files:")
for p in sorted(converted):
    size = os.path.getsize(p) / 1024
    print(f"    {os.path.basename(p):55s} {size:8.1f} KB")

if skipped:
    print(f"\n  Skipped:")
    for name, reason in skipped:
        print(f"    {name:55s} {reason}")

print("\n" + "=" * 60)
print("DONE")
print("=" * 60)
