/**
 * Lightweight memory profiler.
 * Uses performance.memory (Chrome only) and logs snapshots at key pipeline stages.
 * Call perf.mark('label') at each stage, perf.report() at the end.
 */

const snapshots = [];

function getMemoryMB() {
  if (performance.memory) {
    return {
      usedHeap: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
      totalHeap: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
      limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024),
    };
  }
  return null;
}

export function mark(label) {
  const mem = getMemoryMB();
  const entry = {
    label,
    time: performance.now(),
    ...mem,
  };
  snapshots.push(entry);

  if (mem) {
    console.log(`[perf] ${label} — heap: ${mem.usedHeap}MB / ${mem.totalHeap}MB (limit: ${mem.limit}MB)`);
  } else {
    console.log(`[perf] ${label} — (memory API not available, use Chrome with --enable-precise-memory-info)`);
  }
}

export function report() {
  if (snapshots.length === 0) {
    console.log('[perf] No snapshots recorded.');
    return;
  }

  console.log('\n[perf] ===== Memory Report =====');
  console.table(snapshots.map((s, i) => {
    const prev = i > 0 ? snapshots[i - 1] : null;
    const elapsed = prev ? ((s.time - prev.time) / 1000).toFixed(1) + 's' : '—';
    const delta = prev && s.usedHeap != null ? (s.usedHeap - prev.usedHeap) : null;
    const deltaStr = delta != null ? (delta >= 0 ? `+${delta}MB` : `${delta}MB`) : '—';
    return {
      stage: s.label,
      heapUsed: s.usedHeap != null ? `${s.usedHeap}MB` : 'n/a',
      delta: deltaStr,
      elapsed,
    };
  }));

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  if (first.usedHeap != null && last.usedHeap != null) {
    const peak = Math.max(...snapshots.map(s => s.usedHeap || 0));
    console.log(`[perf] Peak heap: ${peak}MB`);
    console.log(`[perf] Net change: ${last.usedHeap - first.usedHeap}MB`);
    console.log(`[perf] Total time: ${((last.time - first.time) / 1000).toFixed(1)}s`);
  }
  console.log('[perf] ============================\n');
}

export function reset() {
  snapshots.length = 0;
}
