"""System 1 (docs/SYSTEM1_PLAN.md, J8a): a checkpoint on the held-out test rows.

Accuracy per question against the class that is always the largest, calibration error, code or not code, and the
light path (J2) simulated at several thresholds: how many tickets that are not about code it would catch, and which
tickets about code it would skip by mistake (that list must stay empty before the light path is switched on).

    python -I eval.py <checkpoint dir> <test.jsonl> <out.json> [label]
    python -I eval.py --rescore <out.json>     the scores and the light path again from the saved answers (no model),
                                               after a rule changed

Run with the environment of agent/README.md (HF_HUB_OFFLINE=1, HF_HOME=tools/hf).
"""
import json
import os
import statistics
import sys
import time
from collections import Counter

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("USE_TF", "0")

CODE = {"bug in code", "change request", "new requirement"}  # lib/system1.mjs CODE_TYPES
MISSING_OF = {"steps": "no steps", "expected": "not what is wrong", "screen": "no screen", "environment": "no where or when"}


def asks(missing, about):
    """J7 (lib/system1.mjs askReporter): what is wrong, or where, is missing, and the report is about code or unclear."""
    return bool({"expected", "screen"} & missing) and about


def would_ask(x):
    """Whether the agent would ask the reporter, from the model's answers at 0.6 (None without the four questions)."""
    a = x["answers"]
    if not all(q in a for q in MISSING_OF):
        return None
    missing = {q for q, o in MISSING_OF.items() if a[q]["choice"] == o and a[q]["p"] >= 0.6}
    about = a.get("code", {}).get("choice") == "needs code" or a.get("type", {}).get("choice") in CODE
    return asks(missing, about or a.get("type", {}).get("choice") == "unclear")


def ece(pairs, bins=5):
    """Expected calibration error over (confidence, right) pairs."""
    total, err = len(pairs), 0.0
    for b in range(bins):
        lo, hi = b / bins, (b + 1) / bins
        inb = [(c, r) for c, r in pairs if lo < c <= hi or (b == 0 and c == 0)]
        if inb:
            err += len(inb) / total * abs(statistics.mean(c for c, _ in inb) - statistics.mean(r for _, r in inb))
    return round(err, 3)


def main(ckpt, test_path, out_path, label="model"):
    import laya

    rows = [json.loads(line) for line in open(test_path, encoding="utf-8") if line.strip()]
    t = time.perf_counter()
    agent = laya.load(ckpt, device="cpu")
    load_s = time.perf_counter() - t
    results, times = [], []
    for r in rows:
        t = time.perf_counter()
        answers = agent.predict(r["state"], r["questions"])["answers"]
        times.append(time.perf_counter() - t)
        results.append({"id": r["meta"]["id"], "source": r["meta"]["source"], "expected": r["expected"],
                        "answers": {k: {"choice": v["choice"], "p": v["probabilities"][v["choice"]], "probs": v["probabilities"]} for k, v in answers.items()}})
    scores, gate = score(results)
    latency = {"load_s": round(load_s, 1), "median_ms": round(1000 * statistics.median(times)), "mean_ms": round(1000 * statistics.mean(times))}
    out = {"label": label, "checkpoint": ckpt, "scores": scores, "gate": gate, "latency": latency, "results": results}
    json.dump(out, open(out_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps({"label": label, "scores": scores, "gate": gate, "latency": latency}, indent=1, ensure_ascii=False))


def rescore(out_path):
    out = json.load(open(out_path, encoding="utf-8"))
    out["scores"], out["gate"] = score(out["results"])
    json.dump(out, open(out_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(json.dumps({"label": out["label"], "scores": out["scores"], "gate": out["gate"]}, indent=1, ensure_ascii=False))


def score(results):
    scores = {}
    questions = sorted({q for x in results for q in x["expected"]})
    for q in questions:
        rows = [x for x in results if q in x["expected"] and q in x["answers"]]
        if not rows:
            continue
        pairs = [(x["answers"][q]["p"], x["answers"][q]["choice"] == x["expected"][q]) for x in rows]
        majority = Counter(x["expected"][q] for x in rows).most_common(1)[0][1] / len(pairs)
        scores[q] = {"n": len(pairs), "accuracy": round(sum(r for _, r in pairs) / len(pairs), 3), "majority": round(majority, 3),
                     "mean_confidence": round(statistics.mean(c for c, _ in pairs), 3), "ece": ece(pairs)}
    # Known issue (J4): the reworded reports and the four LAB-8 sentences apart; a "none" answer on a known issue is a miss.
    for source in ("reworded", "lab8", "jira", "written"):
        rows = [x for x in results if x["source"] == source and "known" in x["expected"] and "known" in x["answers"]]
        if rows:
            scores[f"known/{source}"] = {"n": len(rows), "right": sum(x["answers"]["known"]["choice"] == x["expected"]["known"] for x in rows),
                                         "answers": [f"{x['id']}: {x['answers']['known']['choice'][:40]} ({x['answers']['known']['p']:.2f})" for x in rows] if source == "lab8" else None}
    # The component of an Ask question (J5) apart from the tickets': the router answers without Claude only at 0.7 or more.
    arows = [x for x in results if x["source"] == "ask" and "component" in x["expected"] and "component" in x["answers"]]
    if arows:
        sure = [x for x in arows if x["answers"]["component"]["p"] >= 0.7]
        scores["component/ask"] = {"n": len(arows), "accuracy": round(sum(x["answers"]["component"]["choice"] == x["expected"]["component"] for x in arows) / len(arows), 3),
                                   "sure_at_0.7": len(sure), "sure_but_wrong": [x["id"] for x in sure if x["answers"]["component"]["choice"] != x["expected"]["component"]]}
    # Privacy (J6): a missed name is the costly error; a false hold only delays a ticket.
    # J7: would the agent ask the reporter (lib/system1.mjs askReporter, at 0.6), against the labels a person gave?
    crows = [x for x in results if all(q in x["expected"] and q in x["answers"] for q in MISSING_OF)]
    if crows:
        def should_ask(x):
            missing = {q for q, o in MISSING_OF.items() if x["expected"][q] == o}
            return asks(missing, x["expected"].get("type") in CODE or x["expected"].get("type") == "unclear")

        scores["complete/ask"] = {"n": len(crows), "should_ask": sum(should_ask(x) for x in crows),
                                  "asked_right": [x["id"] for x in crows if would_ask(x) and should_ask(x)],
                                  "asked_wrongly": [x["id"] for x in crows if would_ask(x) and not should_ask(x)],
                                  "missed": [x["id"] for x in crows if should_ask(x) and not would_ask(x)]}
    # The real ticket texts apart (demo/system1/privacy-real.json), at the policy's 0.7: what a hold would do in use.
    rrows = [x for x in results if x["source"] == "privacy-real" and "privacy" in x["answers"]]
    if rrows:
        held = lambda x: x["answers"]["privacy"]["probs"].get("names a person", 0) >= 0.7  # noqa: E731
        scores["privacy/real"] = {"n": len(rrows), "with_a_name": sum(x["expected"]["privacy"] == "names a person" for x in rrows),
                                  "caught_at_0.7": [x["id"] for x in rrows if x["expected"]["privacy"] == "names a person" and held(x)],
                                  "missed_at_0.7": [x["id"] for x in rrows if x["expected"]["privacy"] == "names a person" and not held(x)],
                                  "false_holds_at_0.7": [x["id"] for x in rrows if x["expected"]["privacy"] == "no person" and held(x)]}
    prows = [x for x in results if "privacy" in x["expected"]]
    if prows:
        scores["privacy/errors"] = {
            "names_missed": [x["id"] for x in prows if x["expected"]["privacy"] == "names a person" and x["answers"]["privacy"]["choice"] != "names a person"],
            "false_holds": [x["id"] for x in prows if x["expected"]["privacy"] == "no person" and x["answers"]["privacy"]["choice"] == "names a person"],
        }

    intake = [x for x in results if "type" in x["expected"] and "type" in x["answers"]]
    for x in intake:
        x["p_not_code"] = round(sum(p for k, p in x["answers"]["type"]["probs"].items() if k not in CODE), 4)
        x["side_not_code"] = x["answers"].get("side", {}).get("probs", {}).get("not code", 0)
        x["code_not_code"] = x["answers"].get("code", {}).get("probs", {}).get("no code change")
    is_code = lambda x: x["expected"]["type"] in CODE  # noqa: E731
    scores["code_or_not"] = {"n": len(intake), "accuracy": round(sum((x["p_not_code"] < 0.5) == is_code(x) for x in intake) / len(intake), 3)} if intake else {}
    n_not = sum(not is_code(x) for x in intake)
    # The light path (J2) under three rules: the type alone, type and side, and every signal (with the code question).
    # A report the agent would ask the reporter about (J7) never takes it (lib/system1.mjs lightPath).
    rules = {
        "type": lambda x: x["p_not_code"],
        "type+side": lambda x: min(x["p_not_code"], x["side_not_code"]),
        "type+side+code": lambda x: min(x["p_not_code"], x["side_not_code"], x["code_not_code"]) if x["code_not_code"] is not None else None,
        "code": lambda x: x["code_not_code"],
    }
    gate = {}
    for name, f in rules.items():
        if any(f(x) is None for x in intake):
            continue
        for thr in (0.5, 0.7, 0.8, 0.9):
            light = [x for x in intake if f(x) >= thr and not would_ask(x)]
            gate[f"{name}@{thr}"] = {"light_path": len(light), "not_code_caught": f"{sum(not is_code(x) for x in light)}/{n_not}", "code_wrongly_skipped": [x["id"] for x in light if is_code(x)]}
    return scores, gate


if __name__ == "__main__":
    if sys.argv[1] == "--rescore":
        rescore(sys.argv[2])
    else:
        main(*sys.argv[1:5])
