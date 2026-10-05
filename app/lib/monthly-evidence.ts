/** Only consecutive calendar months may contribute a one-month change. Gaps stay gaps. */
export function consecutiveMonthlyChanges(left: Map<string, number>, right: Map<string, number>) {
  const months = [...left.keys()].filter(month => right.has(month)).sort();
  const result = {left: [] as number[], right: [] as number[], periods: [] as string[]};
  for (let i = 1; i < months.length; i++) {
    const [ay,am] = months[i-1].split('-').map(Number), [by,bm] = months[i].split('-').map(Number);
    if ((by-ay)*12 + bm-am !== 1) continue;
    result.left.push(left.get(months[i])! - left.get(months[i-1])!);
    result.right.push(right.get(months[i])! - right.get(months[i-1])!);
    result.periods.push(months[i]);
  }
  return result;
}
