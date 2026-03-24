# scripts/convert_rppg_to_onnx.py
# Run: python scripts/convert_rppg_to_onnx.py
# Requirements: pip install skl2onnx onnxmltools xgboost scikit-learn joblib numpy onnx

import pickle, os, json, warnings, copy
import numpy as np
import xgboost as xgb
warnings.filterwarnings("ignore")

# ── CRITICAL: import FloatTensorType from onnxmltools, NOT skl2onnx ──────────
from onnxmltools.convert.common.data_types import FloatTensorType
import onnxmltools

BUNDLE_PATH = "HRV_rPPG_Risk_score_Output_Dumped_model.pkl"
OUT_DIR     = "models/onnx/rppg"
os.makedirs(OUT_DIR, exist_ok=True)

# Check if the rPPG model file exists
if not os.path.exists(BUNDLE_PATH):
    print(f"ERROR: {BUNDLE_PATH} not found!")
    print(f"Please place {BUNDLE_PATH} at the repository root before running this script.")
    exit(1)

with open(BUNDLE_PATH, "rb") as f:
    bundle = pickle.load(f)

# Extract model information - adjust based on actual rPPG model structure
try:
    # Try common keys that might be in the rPPG model
    if "feature_names" in bundle:
        FEATURES = bundle["feature_names"]
    elif "features" in bundle:
        FEATURES = bundle["features"]
    else:
        # Default to generic feature names if not found
        N_FEATURES = bundle.get("n_features", 10)  # Adjust as needed
        FEATURES = [f"feature_{i}" for i in range(N_FEATURES)]
    
    N_FEATURES = len(FEATURES)
    
    # Try to extract model components
    if "model" in bundle:
        model = bundle["model"]
    elif "classifier" in bundle:
        model = bundle["classifier"]
    elif "risk_model" in bundle:
        model = bundle["risk_model"]
    else:
        # If it's a direct XGBoost model
        model = bundle
        
except Exception as e:
    print(f"ERROR parsing rPPG model structure: {e}")
    print("The rPPG model structure might be different from expected.")
    exit(1)

print(f"rPPG Model Features ({N_FEATURES}): {FEATURES}")
print(f"Model type: {type(model)}\n")

# ── Save metadata.json ────────────────────────────────────────────────────────
metadata = {
    "feature_names": FEATURES,
    "model_type": "rPPG_risk_score",
    "n_features": N_FEATURES,
    "feature_index_map": {f"f{i}": name for i, name in enumerate(FEATURES)},
}

# Add any additional metadata from the bundle
for key in ["scaler", "thresholds", "risk_levels", "trained_at", "model_metrics"]:
    if key in bundle:
        if key == "scaler" and hasattr(bundle[key], 'mean_'):
            # Extract scaler parameters instead of the object itself
            scaler = bundle[key]
            metadata[key] = {
                "mean": scaler.mean_.tolist() if hasattr(scaler, 'mean_') else None,
                "scale": scaler.scale_.tolist() if hasattr(scaler, 'scale_') else None,
                "type": type(scaler).__name__
            }
        else:
            metadata[key] = bundle[key]

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


# ── Convert rPPG model to ONNX ───────────────────────────────────────────
initial_type = [("float_input", FloatTensorType([None, N_FEATURES]))]

print(f"\nConverting rPPG risk score model...")

try:
    # Debug: print model structure
    print(f"Model structure: {type(model)}")
    if isinstance(model, dict):
        print(f"Model keys: {list(model.keys())}")
    
    # Handle the rPPG model structure which has classifiers and regressors
    if isinstance(model, dict) and "classifiers" in model and "regressors" in model:
        # This is similar to the menstrual model structure
        classifiers = model["classifiers"]
        regressors = model["regressors"]
        
        # Get disease names (or risk categories for rPPG)
        if "diseases" in model:
            risk_categories = model["diseases"]
        else:
            risk_categories = list(classifiers.keys())
        
        print(f"Found {len(risk_categories)} risk categories: {risk_categories}")
        
        # Convert each classifier and regressor
        for category in risk_categories:
            print(f"\nConverting {category}...")
            
            # Classifier
            if category in classifiers:
                clf = classifiers[category]
                if hasattr(clf, 'get_booster'):
                    clf_stripped = strip_feature_names(clf)
                    clf_onnx = onnxmltools.convert_xgboost(
                        clf_stripped,
                        initial_types=initial_type,
                        target_opset=12,
                    )
                    clf_path = os.path.join(OUT_DIR, f"{category}_clf.onnx")
                    with open(clf_path, "wb") as f:
                        f.write(clf_onnx.SerializeToString())
                    print(f"  ✓ {category}_clf.onnx")
            
            # Regressor
            if category in regressors:
                reg = regressors[category]
                if hasattr(reg, 'get_booster'):
                    reg_stripped = strip_feature_names(reg)
                    reg_onnx = onnxmltools.convert_xgboost(
                        reg_stripped,
                        initial_types=initial_type,
                        target_opset=12,
                    )
                    reg_path = os.path.join(OUT_DIR, f"{category}_reg.onnx")
                    with open(reg_path, "wb") as f:
                        f.write(reg_onnx.SerializeToString())
                    print(f"  ✓ {category}_reg.onnx")
        
        print(f"\n{'='*55}")
        print(f"All rPPG ONNX models exported to: {OUT_DIR}")
        print(f"Metadata written to: {os.path.join(OUT_DIR, 'metadata.json')}")
        print(f"{'='*55}")
        print("\nIMPORTANT: Feature order for Node.js inference (must match exactly):")
        for i, name in enumerate(FEATURES):
            print(f"  f{i} → {name}")
        print(f"\nSet RPPG_MODELS_DIR environment variable to: ./{OUT_DIR}")
        
    else:
        # Handle single model case (original logic)
        if isinstance(model, dict):
            # Try to find the actual model in the dictionary
            if "model" in model:
                actual_model = model["model"]
            elif "risk_model" in model:
                actual_model = model["risk_model"]
            elif "classifier" in model:
                actual_model = model["classifier"]
            else:
                # If it's a dict with sklearn objects, try the first one
                for key, value in model.items():
                    if hasattr(value, 'predict') or hasattr(value, 'get_booster'):
                        actual_model = value
                        break
                else:
                    raise ValueError("No compatible model found in dictionary")
            
            model = actual_model
        
        if hasattr(model, 'get_booster'):
            # XGBoost model with sklearn wrapper
            model_stripped = strip_feature_names(model)
            
            rppg_onnx = onnxmltools.convert_xgboost(
                model_stripped,
                initial_types=initial_type,
                target_opset=12,
            )
            model_name = "rppg_risk_score.onnx"
        elif isinstance(model, xgb.Booster):
            # Direct XGBoost booster
            rppg_onnx = onnxmltools.convert_xgboost(
                model,
                initial_types=initial_type,
                target_opset=12,
            )
            model_name = "rppg_risk_score.onnx"
        else:
            # Try with sklearn converter
            from skl2onnx import convert_sklearn
            rppg_onnx = convert_sklearn(
                model,
                initial_types=initial_type,
                target_opset=12,
            )
            model_name = "rppg_risk_score.onnx"

        model_path = os.path.join(OUT_DIR, model_name)
        with open(model_path, "wb") as f:
            f.write(rppg_onnx.SerializeToString())
        print(f"  ✓ {model_name}")

except Exception as e:
    print(f"ERROR converting rPPG model: {e}")
    print("The rPPG model might need custom conversion logic.")
    exit(1)

print(f"\n{'='*55}")
print(f"rPPG ONNX model exported to: {OUT_DIR}")
print(f"Metadata written to: {os.path.join(OUT_DIR, 'metadata.json')}")
print(f"{'='*55}")
print("\nIMPORTANT: Feature order for Node.js inference (must match exactly):")
for i, name in enumerate(FEATURES):
    print(f"  f{i} → {name}")
print(f"\nSet RPPG_MODELS_DIR environment variable to: ./{OUT_DIR}")
