import { readFile, appendFile } from 'node:fs/promises';

const sourceLabels = {
  headline: 'Headline inflation',
  core: 'Core inflation',
  unemployment: 'Unemployment',
  opr: 'Overnight policy rate',
  fx: 'USD/MYR',
  mgs: '10-year MGS yield',
};

function cell(value) {
  return String(value ?? 'Not available').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
}

export function renderRefreshSummary({ jobStatus, dashboardChanged, dashboardValidated, dashboard }) {
  const succeeded = jobStatus === 'success';
  const lines = [
    '# MacroLens dashboard refresh',
    '',
    `**Workflow result:** ${succeeded ? 'Succeeded' : 'Did not complete successfully'}`,
    `**Published artifact changed:** ${dashboardChanged === 'true' ? 'Yes — validated changes were pushed' : dashboardChanged === 'false' ? 'No repository artifact change was needed' : 'Not confirmed (the commit step did not finish)'}`,
  ];

  if (dashboardValidated === 'true' && dashboard && typeof dashboard === 'object') {
    lines.push(
      '',
      '## Validated dashboard artifact inspected in this run',
      '',
      `- **Artifact timestamp (UTC):** ${cell(dashboard.generatedAt)}`,
      `- **Overall data status:** ${cell(dashboard.health)}`,
      '',
      '| Source | Status | Latest observation | Retrieved |',
      '| --- | --- | --- | --- |',
    );

    for (const [key, label] of Object.entries(sourceLabels)) {
      const source = dashboard.sources?.[key] ?? {};
      lines.push(`| ${label} | ${cell(source.status)} | ${cell(source.observationPeriod)} | ${cell(source.retrievedAt)} |`);
    }
  } else if (dashboardValidated !== 'true') {
    lines.push('', 'This run did not confirm a valid dashboard artifact. Do not treat its generated files as a fresh publication.');
  } else {
    lines.push('', 'The validated dashboard artifact could not be read for this summary. Check the workflow log.');
  }

  if (!succeeded) {
    lines.push('', 'The run was not marked successful. Review the failed step above. Any validated candidate shown here may not have been pushed; the public dashboard remains on the last version known to have been published.');
  } else {
    lines.push('', 'A successful run means the generated artifact passed validation. “No repository artifact change” means no artifact diff needed committing; it does not mean the scheduled job was skipped.');
  }
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node scripts/refresh-summary.mjs <dashboard.json>');

  let dashboard = null;
  try {
    dashboard = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    // Preserve the workflow outcome even if the summary cannot read the artifact.
  }

  const summary = renderRefreshSummary({
    jobStatus: process.env.JOB_STATUS,
    dashboardChanged: process.env.DASHBOARD_CHANGED,
    dashboardValidated: process.env.DASHBOARD_VALIDATED,
    dashboard,
  });
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, 'utf8');
  } else {
    process.stdout.write(`${summary}\n`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
