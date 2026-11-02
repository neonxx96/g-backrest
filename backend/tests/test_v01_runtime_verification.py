from scripts.verify_v01_runtime import analyze_cluster_observations, summarize_health


def test_health_summary_reports_median_and_nearest_rank_p95_in_ms():
    summary = summarize_health([0.010, 0.200, 1.000, 0.100, 0.300])

    assert summary == {
        "samples": 5,
        "median_ms": 200.0,
        "p95_ms": 1000.0,
        "max_ms": 1000.0,
    }


def test_cluster_analysis_finds_missing_5m_bucket_and_forming_growth():
    observations = [
        {
            "observed_at": "2026-11-02T00:00:10Z",
            "candles": [
                {"timestamp": 0, "total_volume": 100.0},
                {"timestamp": 300_000, "total_volume": 10.0},
            ],
        },
        {
            "observed_at": "2026-11-02T00:00:20Z",
            "candles": [
                {"timestamp": 0, "total_volume": 100.0},
                {"timestamp": 300_000, "total_volume": 12.5},
                {"timestamp": 900_000, "total_volume": 1.0},
            ],
        },
    ]

    analysis = analyze_cluster_observations(observations)

    assert analysis["candle_timestamps"] == [0, 300_000, 900_000]
    assert analysis["missing_timestamps"] == [600_000]
    assert analysis["forming_volume_grew"] is True
    assert analysis["volume_growth_events"] == 1

