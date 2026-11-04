# Benchmark

Performance and capacity benchmarks for Agent World.

## How to run

There is no benchmark harness in this repository yet: no `bench` script exists in
any `package.json` and no benchmark sources live under `packages/`. Until one is
added, this document intentionally publishes no commands or numbers rather than
inventing them.

## Scope

What is measured (update as benchmarks are added):

- Engine scheduling throughput (graphs / sec)
- Event stream append & fold latency (events / sec)
- Concurrency behavior under parallel / fanout nodes
- Memory footprint of long runs (event log growth)
- Cold-start & restart times (server, board)
- Sandboxed code exec overhead (node types: code / HTTP / subprocess)

## Results

| Date | Baseline (commit / version) | Scenario | Metric | Value | Notes |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

## Known limits

Not measured yet: capacity limits and resource ceilings will be documented here
once the harness above exists and produces reproducible numbers.
