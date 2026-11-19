// Each page contains synthetic records. The cursor carries the expected result
// privately so a different edge instance can validate the next request.
function integer(max) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % max;
}

function shuffled(rows) {
  for (let i = rows.length - 1; i > 0; i--) {
    const j = integer(i + 1);
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}

function reference() {
  return crypto.randomUUID().slice(0, 13);
}

function allocations(instructions) {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    bin: reference(),
    available_cases: 1 + integer(50),
    units_per_case: 2 + integer(30),
    held: i < 2,
  }));
  const eligible = rows.filter(row => !row.held);
  const units = row => row.available_cases * row.units_per_case;
  eligible.sort((a, b) => units(b) - units(a) || a.bin.localeCompare(b.bin));
  const selected = eligible[0];
  return {
    detail: instructions,
    records: shuffled(rows),
    answer: { record: selected.bin, value: units(selected) },
  };
}

function journal(instructions) {
  const ledger = reference();
  const other = reference();
  const rows = Array.from({ length: 7 }, (_, i) => ({
    ledger: i % 3 === 0 ? other : ledger,
    status: i % 4 === 0 ? 'pending' : 'posted',
    received: 1 + integer(70),
    issued: integer(50),
  }));
  const value = rows.filter(row => row.ledger === ledger && row.status === 'posted')
    .reduce((total, row) => total + row.received - row.issued, 0);
  return {
    detail: instructions.replaceAll('{ledger}', ledger),
    records: shuffled(rows),
    answer: { record: ledger, value },
  };
}

function extents(instructions) {
  let next = 1;
  const gap = 2 + integer(3);
  const rows = Array.from({ length: 6 }, (_, i) => {
    if (i === gap) next += 1 + integer(9);
    const row = { segment: reference(), first: next, last: next + integer(39) };
    next = row.last + 1;
    return row;
  });
  const last = rows[gap - 1];
  return {
    detail: instructions,
    records: shuffled(rows),
    answer: { record: last.segment, value: last.last + 1 },
  };
}

export const puzzleTypes = { allocations, journal, extents };

export function manifestPage(enabled, instructions) {
  const name = enabled[integer(enabled.length)];
  return puzzleTypes[name](instructions[name]);
}
