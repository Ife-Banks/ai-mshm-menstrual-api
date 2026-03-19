import pickle, os, json, warnings, tempfile
import numpy as np

warnings.filterwarnings("ignore")

from onnxmltools.convert.common.data_types import FloatTensorType
import onnxmltools
import xgboost as xgb

BUNDLE_PATH = "mood_cognitive_all_models.pkl"
OUT_DIR = "models/onnx/mood"
os.makedirs(OUT_DIR, exist_ok=True)

with open(BUNDLE_PATH, "rb") as f:
    bundle = pickle.load(f)

DISEASES = bundle["disease_names"]
FEATURES = bundle["feature_names"]
N_FEATURES = len(FEATURES)

print(f"Diseases ({len(DISEASES)}): {DISEASES}")
print(f"Features: {N_FEATURES}")

metadata = {
    "feature_names": FEATURES,
    "diseases": DISEASES,
    "n_features": N_FEATURES,
    "flag_thresholds": {
        d: bundle["disease_meta"][d]["flag_threshold"] for d in DISEASES
    },
    "layer_weights": {d: bundle["disease_meta"][d]["layer_weight"] for d in DISEASES},
    "descriptions": {d: bundle["disease_meta"][d]["description"] for d in DISEASES},
    "severity_bins": bundle["severity_bins"],
    "severity_labels": bundle["severity_labels"],
    "feature_medians": bundle["dataset_stats"]["feature_medians"],
    "model_performance": bundle["model_performance"],
    "feature_index_map": {f"f{i}": name for i, name in enumerate(FEATURES)},
    "disease_groups": {
        "mental_health": ["Anxiety", "Depression", "PMDD", "ChronicStress"],
        "metabolic": ["T2D_Mood", "MetSyn_Mood"],
        "cardio_neuro": ["CVD_Mood", "Stroke_Mood"],
        "reproductive": ["Infertility_Mood"],
    },
}

with open(os.path.join(OUT_DIR, "metadata.json"), "w") as f:
    json.dump(metadata, f, indent=2)
print("✓ metadata.json saved")

initial_type = [("float_input", FloatTensorType([None, N_FEATURES]))]


def strip_feature_names(model):
    booster = model.get_booster()
    tmp_path = tempfile.NamedTemporaryFile(suffix=".json", delete=False).name
    booster.save_model(tmp_path)
    with open(tmp_path, "r") as f:
        model_json = json.load(f)
    if "learner" in model_json:
        learner = model_json["learner"]
        learner.pop("feature_names", None)
        learner.pop("feature_types", None)
        if "attributes" in learner:
            learner["attributes"].pop("feature_names", None)
            learner["attributes"].pop("feature_types", None)
    with open(tmp_path, "w") as f:
        json.dump(model_json, f)
    fresh_booster = xgb.Booster()
    fresh_booster.load_model(tmp_path)
    os.unlink(tmp_path)
    EstimatorClass = type(model)
    fresh = EstimatorClass()
    fresh.__dict__.update(model.__dict__)
    fresh._Booster = fresh_booster
    return fresh


for disease in DISEASES:
    print(f"\nConverting {disease}...")
    clf = strip_feature_names(bundle["models"][disease]["clf"])
    clf_onnx = onnxmltools.convert_xgboost(
        clf, initial_types=initial_type, target_opset=12
    )
    with open(os.path.join(OUT_DIR, f"{disease}_clf.onnx"), "wb") as f:
        f.write(clf_onnx.SerializeToString())
    print(f"  ✓ {disease}_clf.onnx")

    reg = strip_feature_names(bundle["models"][disease]["reg"])
    reg_onnx = onnxmltools.convert_xgboost(
        reg, initial_types=initial_type, target_opset=12
    )
    with open(os.path.join(OUT_DIR, f"{disease}_reg.onnx"), "wb") as f:
        f.write(reg_onnx.SerializeToString())
    print(f"  ✓ {disease}_reg.onnx")

print(f"\n{'=' * 55}")
print(f"All 18 ONNX models exported to: {OUT_DIR}")
print(f"{'=' * 55}")
print("\nFeature index map (f0 → feature_name):")
for i, name in enumerate(FEATURES):
    print(f"  f{i:2} → {name}")
