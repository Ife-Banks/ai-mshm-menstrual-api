# scripts/convert_to_onnx.py
# Run: python scripts/convert_to_onnx.py
# Requirements: pip install skl2onnx onnxmltools xgboost scikit-learn joblib numpy onnx

import pickle, os, json, warnings, copy
import numpy as np
import xgboost as xgb
warnings.filterwarnings("ignore")

# ── CRITICAL: import FloatTensorType from onnxmltools, NOT skl2onnx ──────────
from onnxmltools.convert.common.data_types import FloatTensorType
import onnxmltools

BUNDLE_PATH = "ai_mshm_menstrual_pipeline.pkl"
OUT_DIR     = "models/onnx"
os.makedirs(OUT_DIR, exist_ok=True)

with open(BUNDLE_PATH, "rb") as f:
    bundle = pickle.load(f)

FEATURES   = bundle["feature_names"]   # 10 named features
DISEASES   = bundle["diseases"]        # 6 diseases
N_FEATURES = len(FEATURES)

print(f"Features ({N_FEATURES}): {FEATURES}")
print(f"Diseases ({len(DISEASES)}): {DISEASES}\n")

# ── Save metadata.json ────────────────────────────────────────────────────────
# We store the original feature names here so Node.js knows the correct order
metadata = {
    "feature_names":   FEATURES,
    "diseases":        DISEASES,
    "flag_thresholds": bundle["flag_thresholds"],
    "severity_bins":   bundle["severity_bins"],
    "severity_labels": bundle["severity_labels"],
    "scaler_mean":     bundle["scaler"].mean_.tolist(),
    "scaler_scale":    bundle["scaler"].scale_.tolist(),
    "model_metrics":   bundle["model_metrics"],
    "trained_at":      bundle["trained_at"],
    "module":          bundle["module"],
    # Map f0→feature_name so Node.js can debug if needed
    "feature_index_map": {f"f{i}": name for i, name in enumerate(FEATURES)},
}
with open(os.path.join(OUT_DIR, "metadata.json"), "w") as f:
    json.dump(metadata, f, indent=2)
print("✓ metadata.json saved")


def strip_feature_names(booster_model):
    """
    onnxmltools requires XGBoost feature names to follow pattern 'f0','f1','f2'...
    When a model is trained with a pandas DataFrame, XGBoost stores the column
    names internally. We strip them here so the converter sees 'f0','f1','f2'.

    Strategy: save the booster to a temp JSON config, strip feature_names,
    reload into a fresh booster, then wrap back into the sklearn estimator.
    """
    import tempfile

    # Get the underlying Booster
    booster = booster_model.get_booster()

    # Save booster model to a temp file and reload — this forces index-based names
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
        tmp_path = tmp.name

    booster.save_model(tmp_path)

    # Load the JSON and strip feature_names field
    with open(tmp_path, "r") as f:
        model_json = json.load(f)

    # Remove the named feature_names so XGBoost falls back to f0,f1,f2...
    if "learner" in model_json:
        learner = model_json["learner"]
        if "feature_names" in learner:
            del learner["feature_names"]
        if "feature_types" in learner:
            del learner["feature_types"]
        # Also clear from attributes if present
        if "attributes" in learner:
            attrs = learner["attributes"]
            attrs.pop("feature_names", None)
            attrs.pop("feature_types", None)

    # Write stripped JSON back
    with open(tmp_path, "w") as f:
        json.dump(model_json, f)

    # Reload into a fresh booster
    fresh_booster = xgb.Booster()
    fresh_booster.load_model(tmp_path)
    os.unlink(tmp_path)

    # Re-wrap into a fresh sklearn estimator of the same type
    EstimatorClass = type(booster_model)
    fresh_estimator = EstimatorClass()
    fresh_estimator.__dict__.update(booster_model.__dict__)
    fresh_estimator._Booster = fresh_booster

    return fresh_estimator


# ── Convert each XGBoost model to ONNX ───────────────────────────────────────
initial_type = [("float_input", FloatTensorType([None, N_FEATURES]))]

for disease in DISEASES:
    print(f"\nConverting {disease}...")

    # ── Classifier ────────────────────────────────────────────────────────────
    clf         = bundle["classifiers"][disease]
    clf_stripped = strip_feature_names(clf)

    clf_onnx = onnxmltools.convert_xgboost(
        clf_stripped,
        initial_types=initial_type,
        target_opset=12,
    )
    clf_path = os.path.join(OUT_DIR, f"{disease}_clf.onnx")
    with open(clf_path, "wb") as f:
        f.write(clf_onnx.SerializeToString())
    print(f"  ✓ {disease}_clf.onnx")

    # ── Regressor ─────────────────────────────────────────────────────────────
    reg          = bundle["regressors"][disease]
    reg_stripped = strip_feature_names(reg)

    reg_onnx = onnxmltools.convert_xgboost(
        reg_stripped,
        initial_types=initial_type,
        target_opset=12,
    )
    reg_path = os.path.join(OUT_DIR, f"{disease}_reg.onnx")
    with open(reg_path, "wb") as f:
        f.write(reg_onnx.SerializeToString())
    print(f"  ✓ {disease}_reg.onnx")

print(f"\n{'='*55}")
print(f"All {len(DISEASES) * 2} ONNX models exported to: {OUT_DIR}")
print(f"Metadata written to: {os.path.join(OUT_DIR, 'metadata.json')}")
print(f"{'='*55}")
print("\nIMPORTANT: Feature order for Node.js inference (must match exactly):")
for i, name in enumerate(FEATURES):
    print(f"  f{i} → {name}")