# Route loading measurement

Measured the priority-3 build and final priority-4 build using the same saved dashboard (SHA-256 `04fc103a9595547919f64097d6aec53bf8860ebee303338069950c1e7b4cfdb5`). Raw trials are in `2026-10-05-mobile-before.json` and `2026-10-05-mobile-after.json`.

Conditions: local production Worker, Chromium 151.0.7922.34, 390×844 viewport, fresh context/cache disabled per trial, 150 ms latency, 200,000 bytes/s asset download throughput, 4× CPU slowdown, three trials per route. JSON responses are deterministic fixture fulfilments; JSON body bytes are measured separately and do not receive simulated network latency. These are small lab observations, not field Core Web Vitals or public-network benchmarks.

| Route | Initial JS bytes before → after | Dashboard JSON bytes before → after | Median load ms before → after | Median LCP ms before → after |
|---|---:|---:|---:|---:|
| Snapshot | 143,719 → 101,800 | 757,391 → 72,726 | 2,376 → 1,847 | 1,724 → 1,804 |
| Forecast | 143,719 → 103,321 | 757,391 → 15,047 | 2,044 → 1,712 | 1,464 → 1,508 |
| Regional | 143,719 → 102,518 | 757,391 → 40,708 | 2,129 → 1,660 | 1,436 → 1,252 |
| Risk | 143,719 → 99,969 | 757,391 → 6,058 | 1,977 → 1,696 | 2,916 → 2,420 |

Initial JavaScript fell by approximately 28–30%; route JSON bodies fell by 90–99%. Median load times were lower in this run, but Snapshot and Forecast LCP were slightly higher. With only three local trials, no universal speed improvement is claimed. The earlier concurrent after-run is retained in ignored outputs for debugging and is not used in this comparison.

All four routes made zero unopened-history requests. Forecast closed-detail rows fell from 15 to 3 (the small model score table remains); its 12 detailed backtest origins are not mounted or requested until opened. Risk closed-detail rows fell from 9 to 0. A separate hydrated browser check exercises explicit history actions and artifact-bound requests. Import-graph and built-manifest tests cover all 19 routes, including exclusion of unrelated route implementations.

Detailed requests are keyed by content identity, not just the refresh date. A changed artifact returns a conflict instead of combining old summary values with new histories. Existing full dashboard and indicator APIs remain compatible.
