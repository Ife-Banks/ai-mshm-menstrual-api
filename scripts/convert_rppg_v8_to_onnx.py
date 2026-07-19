# scripts/convert_rppg_v8_to_onnx.py
# Run: python scripts/convert_rppg_v8_to_onnx.py
# Requirements: pip install scikit-learn onnx onnxmltools onnxruntime skl2onnx numpy pandas
#
# Reads the .pkl bundle produced by export_v8_models.py and converts every model to ONNX.

import os
import sys
import json
import pickle
import warnings
warnings.filterwarnings('ignore')

import numpy as np

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BUNDLE_PATH = os.path.join(SCRIPT_DIR, '..', 'models', 'rppg_v8', 'rppg_v8_bundle.pkl')
OUT_DIR = os.path.join(SCRIPT_DIR, '..', 'models', 'rppg_v8', 'onnx')
os.makedirs(OUT_DIR, exist_ok=True)

print(f"Loading bundle from {BUNDLE_PATH}...")
with open(BUNDLE_PATH, 'rb') as f:
    bundle = pickle.load(f)

print("Converting models to ONNX format...\n")

# ── Conversion helpers ─────────────────────────────────────────────────────

def _initial_types(n_feat):
    from skl2onnx.common.data_types import FloatTensorType
    return [('input', FloatTensorType((None, n_feat)))]

def convert_regression(model, n_feat, name, out_path):
    from skl2onnx import convert_sklearn
    onx = convert_sklearn(model, initial_types=_initial_types(n_feat), target_opset=16)
    with open(out_path, 'wb') as f:
        f.write(onx.SerializeToString())

def convert_classifier(model, n_feat, name, out_path):
    from skl2onnx import convert_sklearn
    onx = convert_sklearn(
        model,
        initial_types=_initial_types(n_feat),
        target_opset=16,
        options={id(model): {'zipmap': False}},
    )
    with open(out_path, 'wb') as f:
        f.write(onx.SerializeToString())

def convert_lgbm(model, n_feat, name, out_path):
    from onnxmltools import convert_lightgbm
    from onnxmltools.convert.common.data_types import FloatTensorType
    lgbm_initial_types = [('input', FloatTensorType((None, n_feat)))]
    onx = convert_lightgbm(
        model,
        initial_types=lgbm_initial_types,
        target_opset=15,
    )
    with open(out_path, 'wb') as f:
        f.write(onx.SerializeToString())

# Map sklearn class names to converters
def get_converter(model):
    cls = type(model).__name__
    if cls == 'LGBMClassifier':
        return convert_lgbm
    # Classifiers that produce probability outputs
    if cls in ('RandomForestClassifier', 'HistGradientBoostingClassifier',
               'ExtraTreesClassifier', 'SVC', 'KNeighborsClassifier', 'MLPClassifier'):
        return convert_classifier
    # Regressors
    if cls in ('LinearRegression', 'RandomForestRegressor', 'HistGradientBoostingRegressor'):
        return convert_regression
    return None


# ── Convert ────────────────────────────────────────────────────────────────
converted = []
skipped = []

def do_convert(model, n_feat, name, out_path):
    if os.path.exists(out_path):
        converted.append(out_path)
        print(f"  [EXISTS] {name}")
        return
    converter = get_converter(model)
    if not converter:
        skipped.append((name, f"No converter for {type(model).__name__}"))
        print(f"  [SKIP] {name}: No converter for {type(model).__name__}")
        return
    try:
        converter(model, n_feat, name, out_path)
        converted.append(out_path)
        print(f"  [OK]  {name}")
    except Exception as e:
        skipped.append((name, str(e)))
        print(f"  [ERR] {name}: {e}")

# 1. Regression models
print("=" * 60)
print("Regression models")
print("=" * 60)

for target, reg_data in bundle['regression_models'].items():
    n_feat = len(reg_data['features'])
    for algo, model in reg_data['models'].items():
        if algo == 'HistGradientBoosting':
            print(f"  [SKIP] {target}_{algo}: HistGradientBoosting has ONNX TreeEnsemble node limit")
            skipped.append((f"{target}_{algo}", "HistGradientBoosting ONNX TreeEnsemble node limit"))
            continue
        name = f"{target}_{algo}"
        out_path = os.path.join(OUT_DIR, f"reg_{target}_{algo}.onnx")
        do_convert(model, n_feat, name, out_path)

# 2. Risk models
print("\n" + "=" * 60)
print("Risk models")
print("=" * 60)

for domain, rm in bundle['risk_models'].items():
    n_feat = len(rm['features'])

    name = f"risk_{domain}_regressor"
    out_path = os.path.join(OUT_DIR, f"risk_{domain}_regressor.onnx")
    do_convert(rm['regressor'], n_feat, name, out_path)

    name = f"risk_{domain}_classifier"
    out_path = os.path.join(OUT_DIR, f"risk_{domain}_classifier.onnx")
    do_convert(rm['classifier'], n_feat, name, out_path)

# 3. Mood_Check classifiers
print("\n" + "=" * 60)
print("Mood_Check classifiers")
print("=" * 60)

mood_data = bundle['mood_classifier']
n_feat_mood = len(mood_data['features'])

mood_clfs = mood_data.get('all_models', {})
if not mood_clfs:
    mood_clfs = {mood_data['name']: mood_data['model']}

for algo_name, model in mood_clfs.items():
    if algo_name == 'HistGradientBoosting':
        print(f"  [SKIP] mood_check_{algo_name}: HistGradientBoosting has ONNX TreeEnsemble node limit")
        skipped.append((f"mood_check_{algo_name}", "HistGradientBoosting ONNX TreeEnsemble node limit"))
        continue
    name = f"mood_check_{algo_name}"
    out_path = os.path.join(OUT_DIR, f"mood_check_{algo_name}.onnx")
    do_convert(model, n_feat_mood, name, out_path)

# 4. Deep Learning models
print("\n" + "=" * 60)
print("Deep Learning models")
print("=" * 60)

dl_models_data = bundle.get('dl_models', {})
if dl_models_data:
    try:
        import tensorflow as tf
        import tf2onnx

        class CastMask(tf.keras.layers.Layer):
            def call(self, m):
                return tf.cast(tf.expand_dims(m, axis=1), tf.bool)

        class LastTimestep(tf.keras.layers.Layer):
            def call(self, t):
                return t[:, -1, :]

        DL_CUSTOM_OBJECTS = {'CastMask': CastMask, 'LastTimestep': LastTimestep}

        for key, dlm in dl_models_data.items():
            out_path = os.path.join(OUT_DIR, f"dl_{key}.onnx")
            if os.path.exists(out_path):
                converted.append(out_path)
                print(f"  [EXISTS] {key}")
                continue

            keras_path = os.path.join(SCRIPT_DIR, '..', 'models', 'rppg_v8', f"dl_{key}.keras")

            if not os.path.exists(keras_path):
                print(f"  [SKIP] {key}: .keras file not found")
                skipped.append((f"dl_{key}", "keras file not found"))
                continue

            try:
                model = tf.keras.models.load_model(
                    keras_path, compile=False, safe_mode=False,
                    custom_objects=DL_CUSTOM_OBJECTS
                )

                seq_len = dlm['seq_len']
                n_feat = dlm['n_feat']
                input_signature = [
                    tf.TensorSpec(shape=[None, seq_len, n_feat], dtype=tf.float32, name='seq'),
                    tf.TensorSpec(shape=[None, seq_len], dtype=tf.float32, name='mask'),
                ]
                tf2onnx.convert.from_keras(model, input_signature=input_signature, output_path=out_path, opset=16)
                converted.append(out_path)
                print(f"  [OK]  {key}")
            except Exception as e:
                skipped.append((f"dl_{key}", str(e)[:200]))
                print(f"  [ERR] {key}: {e}")

    except ImportError:
        print("  [SKIP] TensorFlow not available")
        for key in dl_models_data:
            skipped.append((f"dl_{key}", "TensorFlow not installed"))
else:
    print("  No DL models in bundle (TensorFlow was not available during export).")

# 5. Write metadata
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
    print(f"    {os.path.basename(p):50s} {size:8.1f} KB")

print(f"\n  Skipped:")
for name, reason in skipped:
    print(f"    {name:50s} {reason}")

print("\n" + "=" * 60)
print("DONE")
print("=" * 60)
