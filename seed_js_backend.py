import requests
import json
import time
from datetime import datetime, timedelta

NODE_BASE = "https://ai-mshm-menstrual-api.onrender.com/api/v1"
DJANGO_USER_ID = "19ef4ef1-958a-4b6d-9d5b-23f6d6a6c2b9"
TIMEOUT = 120

def post(url, payload, headers):
    for attempt in range(3):
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=TIMEOUT)
            return r
        except requests.exceptions.Timeout:
            print(f"    Timeout attempt {attempt+1}/3 — retrying in 15s...")
            time.sleep(15)
        except Exception as e:
            print(f"    Error attempt {attempt+1}/3: {e}")
            time.sleep(10)
    print(f"    FAILED after 3 attempts: {url}")
    return None

def get_node_token():
    r = post(
        f"{NODE_BASE}/auth/token",
        {"external_id": DJANGO_USER_ID},
        {"Content-Type": "application/json"}
    )
    if not r:
        raise Exception("Could not get token")
    token = r.json()["data"]["token"]
    print(f"✓ Node token obtained")
    return token

MOOD_DATA = [
    (1,2,1,0, 6,5, 7,7,6, 7,7.5, "Follicular"),
    (2,2,1,1, 5,5, 6,6,5, 6,7.0, "Follicular"),
    (0,1,0,0, 7,6, 8,7,7, 8,8.0, "Ovulatory"),
    (1,1,1,0, 6,6, 7,8,6, 7,7.5, "Ovulatory"),
    (2,3,2,2, 4,4, 5,5,4, 5,6.0, "Luteal"),
    (3,3,2,2, 3,5, 4,5,3, 4,5.5, "Luteal"),
    (2,2,2,1, 4,4, 5,6,4, 5,6.0, "Luteal"),
    (1,2,1,1, 5,5, 6,6,5, 6,7.0, "Menstrual"),
    (2,2,1,2, 4,4, 5,5,4, 5,6.0, "Menstrual"),
    (1,1,0,1, 6,5, 7,7,6, 7,7.5, "Follicular"),
    (0,1,0,0, 7,7, 8,8,7, 8,8.0, "Follicular"),
    (1,1,1,0, 6,6, 7,7,6, 7,7.0, "Follicular"),
    (2,2,1,1, 5,5, 6,6,5, 6,6.5, "Ovulatory"),
    (1,2,1,0, 6,5, 7,6,6, 7,7.5, "Ovulatory"),
    (2,3,2,2, 4,4, 5,5,4, 5,5.5, "Luteal"),
    (3,2,2,2, 3,5, 4,5,3, 4,5.0, "Luteal"),
    (2,2,2,1, 4,4, 5,6,4, 5,6.0, "Luteal"),
    (2,3,2,2, 3,4, 4,4,3, 4,5.5, "Luteal"),
    (1,2,1,1, 5,5, 6,6,5, 6,7.0, "Menstrual"),
    (2,2,1,2, 4,4, 5,5,4, 5,6.0, "Menstrual"),
    (1,1,0,1, 6,5, 7,7,6, 7,7.5, "Follicular"),
    (0,0,0,0, 8,7, 9,8,8, 8,8.5, "Follicular"),
    (1,1,1,0, 6,6, 7,7,6, 7,7.0, "Follicular"),
    (2,2,1,1, 5,5, 6,6,5, 6,6.5, "Ovulatory"),
    (2,3,2,2, 4,4, 5,5,4, 5,5.5, "Luteal"),
    (3,3,2,2, 3,5, 4,5,3, 4,5.0, "Luteal"),
    (2,2,2,2, 2,2, 4,4,3, 4,5.5, "Luteal"),
    (2,2,2,2, 4,4, 5,5,4, 5,6.0, "Luteal"),
]

def seed_mood(token):
    print("\n--- Seeding Mood Logs (28 days) ---")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    today = datetime.today()

    # Test first entry to see actual error
    print("  Testing single mood log first...")
    test_date = (today - timedelta(days=27)).strftime("%Y-%m-%d")
    m = MOOD_DATA[0]
    test_payload = {
        "phq4_item1": m[0], "phq4_item2": m[1],
        "phq4_item3": m[2], "phq4_item4": m[3],
        "affect_valence": m[4], "affect_arousal": m[5],
        "focus_score": m[6], "memory_score": m[7],
        "mental_fatigue": m[8],
        "sleep_quality": m[9], "hours_slept": float(m[10]),
        "cycle_phase": m[11],
        "log_date": test_date
    }
    print(f"  Payload: {json.dumps(test_payload)}")
    try:
        r = requests.post(
            f"{NODE_BASE}/mood/log/complete",
            json=test_payload,
            headers=headers,
            timeout=TIMEOUT
        )
        print(f"  Test result: {r.status_code}")
        print(f"  Response: {r.text[:500]}")
    except Exception as e:
        print(f"  Test exception: {e}")
        return

    if r.status_code not in [200, 201]:
        print("  STOPPING — fix the error above first")
        return

    # If test passed, seed all 28 days
    for i, m in enumerate(MOOD_DATA):
        log_date = (today - timedelta(days=27-i)).strftime("%Y-%m-%d")
        payload = {
            "phq4_item1": m[0], "phq4_item2": m[1],
            "phq4_item3": m[2], "phq4_item4": m[3],
            "affect_valence": m[4], "affect_arousal": m[5],
            "focus_score": m[6], "memory_score": m[7],
            "mental_fatigue": m[8],
            "sleep_quality": m[9], "hours_slept": float(m[10]),
            "cycle_phase": m[11],
            "log_date": log_date
        }
        r = post(f"{NODE_BASE}/mood/log/complete", payload, headers)
        status = r.status_code if r else "FAILED"
        msg = ""
        if r and r.status_code not in [200, 201]:
            try:
                msg = r.json().get("message", r.text[:100])
            except:
                msg = r.text[:100]
        print(f"  Day {i+1}/28 ({log_date}): {status} {msg}")
        time.sleep(1)

    print("✓ Mood logs done")

def run_predictions(token):
    print("\n--- Running Predictions ---")
    headers = {"Authorization": f"Bearer {token}"}
    endpoints = [
        "/mood/predict/mental-health",
        "/mood/predict/metabolic",
        "/mood/predict/cardio-neuro",
        "/mood/predict/reproductive",
    ]
    for ep in endpoints:
        try:
            r = requests.post(
                f"{NODE_BASE}{ep}",
                headers=headers,
                timeout=TIMEOUT
            )
            msg = ""
            if r.status_code not in [200, 201]:
                try:
                    msg = r.json().get("message", "")
                except:
                    msg = r.text[:100]
            print(f"  {ep}: {r.status_code} {msg}")
        except Exception as e:
            print(f"  {ep}: EXCEPTION — {e}")
        time.sleep(3)
    print("✓ Predictions done")

if __name__ == "__main__":
    print("=== Seeding Mood & Predictions ===\n")
    token = get_node_token()
    seed_mood(token)
    run_predictions(token)
    print("\n=== Done ===")