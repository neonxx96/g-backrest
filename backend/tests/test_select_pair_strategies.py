import pandas as pd

from scripts.select_pair_strategies import (
    split_train_oos, is_qualified, pick_best, summarize, MIN_TRADES_OOS,
)


def test_split_is_chronological_70_30():
    df = pd.DataFrame({"x": range(100)})
    tr, oos = split_train_oos(df)
    assert len(tr) == 70 and len(oos) == 30
    assert tr["x"].max() < oos["x"].min()  # no look-ahead


def test_is_qualified_requires_all_conditions():
    good = {"trades": MIN_TRADES_OOS, "net": 1.0, "pf": 1.2}
    assert is_qualified(good)
    assert not is_qualified({**good, "net": 0.0})
    assert not is_qualified({**good, "pf": 1.0})
    assert not is_qualified({**good, "trades": MIN_TRADES_OOS - 1})


def test_pick_best_by_train_only_and_none_when_all_negative():
    t = lambda n, pf, net: {"strategy": n, "train": {"trades": 20, "net": net, "pf": pf}}
    assert pick_best([t("a", 0.5, -5), t("b", 0.9, -1)]) is None
    assert pick_best([t("a", 1.3, 2), t("b", 1.8, 1), t("c", 2.0, -1)])["strategy"] == "b"


def test_summarize_handles_missing_keys():
    assert summarize({})["trades"] == 0
